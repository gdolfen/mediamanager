import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'mediamanager-test-'));
const UPLOAD = path.join(BASE, 'upload');
const FOTOS = path.join(BASE, 'fotos');
const VIDEOS = path.join(BASE, 'videos');
const DATA = path.join(BASE, 'data');

process.env.UPLOAD_DIR = UPLOAD;
process.env.FOTOS_DIR = FOTOS;
process.env.VIDEOS_DIR = VIDEOS;
process.env.DATA_DIR = DATA;
process.env.PORT = '0';

const { startServer } = await import('../src/index.ts');

function log(...args: unknown[]) {
  console.log('  [smoke]', ...args);
}

async function makeImage(file: string, w = 640, h = 480, color = { r: 200, g: 100, b: 50 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toFile(file);
}

async function makeImageExif(file: string, make: string, model: string, w = 480, h = 360, color = { r: 90, g: 90, b: 200 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .withExif({ IFD0: { Make: make, Model: model } })
    .jpeg().toFile(file);
}

async function setupFixtures() {
  fs.mkdirSync(UPLOAD, { recursive: true });
  fs.mkdirSync(FOTOS, { recursive: true });
  fs.mkdirSync(VIDEOS, { recursive: true });
  await makeImage(path.join(UPLOAD, 'IMG_20240101_123456.jpg'));
  await makeImage(path.join(UPLOAD, '20240201_100000.jpg'), 480, 320, { r: 10, g: 200, b: 90 });
  await makeImage(path.join(UPLOAD, 'PXL_20240301_090000.jpg'), 500, 500, { r: 30, g: 40, b: 200 });
  await makeImage(path.join(UPLOAD, 'holiday_photo.jpg'), 300, 200, { r: 250, g: 220, b: 0 });
  const sub = path.join(UPLOAD, 'sub', 'tief');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '2024_notes.txt'), 'nur text');
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, cond: boolean, detail?: string) {
  results.push({ name, ok: Boolean(cond), detail });
  log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

let baseUrl = '';
let server: ReturnType<typeof startServer> | null = null;

async function req(method: string, url: string, body?: unknown) {
  const r = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, json };
}

async function waitForIdle() {
  for (let i = 0; i < 120; i++) {
    const { json } = await req('GET', '/transfer/status');
    if (json && json.status !== 'running') return json;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('Transfer läuft zu lange');
}

async function waitForTargetIdle() {
  for (let i = 0; i < 120; i++) {
    const { json } = await req('GET', '/scan/targets/status');
    if (json && json.status !== 'running') return json;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('Zielordner-Scan läuft zu lange');
}

async function waitForRecheckIdle() {
  for (let i = 0; i < 120; i++) {
    const { json } = await req('GET', '/problems/recheck/status');
    if (json && json.status !== 'running') return json;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('Neubewertung läuft zu lange');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(path.relative(BASE, p));
  }
  return out;
}

let failed = false;
try {
  await setupFixtures();
  log(`Basis: ${BASE}`);

  server = startServer(0);
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
  await new Promise((res) => setTimeout(res, 300));

  // Test-Isolation: Die Testinstanz muss eine EIGENE Test-DB verwenden (zweite Instanz),
  // niemals die Produktions-DB unter lokal/data.
  const { dataDir } = await import('../src/db/database.ts');
  const testDb = path.resolve(dataDir(), 'mediamanager.db');
  const prodPrefix = path.resolve(process.cwd(), '..', 'lokal', 'data').toLowerCase();
  log(`Test-DB: ${testDb}`);
  check('Test nutzt eigene Test-DB (zweite Instanz)', testDb.startsWith(BASE) && !testDb.toLowerCase().startsWith(prodPrefix), testDb);

  await req('PUT', '/settings', { paths: { upload: UPLOAD, fotos: FOTOS, videos: VIDEOS } });
  const settings = await req('GET', '/settings');
  check('Settings gespeichert', settings.json.paths.upload === UPLOAD);

  const d1 = await req('POST', '/devices', { mappedName: 'iPhone15', identifiers: [{ kind: 'filename', value: 'IMG_' }] });
  const d2 = await req('POST', '/devices', { mappedName: 'Pixel8', identifiers: [{ kind: 'filename', value: 'PXL_' }] });
  const d3 = await req('POST', '/devices', { mappedName: 'TestCam', identifiers: [{ kind: 'filename', value: 'holiday' }] });
  check('3 Geräte angelegt', d1.status === 201 && d2.status === 201 && d3.status === 201);

  const start = await req('POST', '/transfer');
  check('Transfer startet', start.status === 202, String(start.json?.error));
  const state1 = await waitForIdle();
  log(`Run 1: scanned=${state1.scanned} transferred=${state1.transferred} skipped=${state1.skipped} problems=${state1.problems}`);
  check('5 Dateien gescannt', state1.scanned === 5);
  check('holiday_photo übertragen', state1.transferred === 1);

  const probs = await req('GET', '/problems?resolved=false');
  const types = probs.json.rows.map((p: any) => p.type);
  check('Probleme erkannt', ['UNKNOWN_DEVICE', 'DATE_MISMATCH_FILENAME', 'UNSUPPORTED_FORMAT', 'NO_META_DATE'].every((t) => types.includes(t)), types.join(','));

  const fotosTree = walk(FOTOS);
  log('Fotos-Struktur:', JSON.stringify(fotosTree));
  check('Zielordner angelegt', fotosTree.some((f) => f.includes('TestCam')));

  const files = await req('GET', '/files?status=transferred');
  check('holiday in DB übertragen', files.json.total === 1 && files.json.rows[0].targetRelPath.includes('TestCam'), files.json.rows[0]?.targetRelPath);

  const imgProblem = probs.json.rows.find((p: any) => p.type === 'DATE_MISMATCH_FILENAME' && p.file.originalName.startsWith('IMG_'));
  const resolve = await req('POST', `/problems/${imgProblem.id}/resolve`, { action: 'accept_filename_date' });
  check('Lösung angewendet', resolve.json.ok === true);

  await req('POST', '/transfer');
  const state2 = await waitForIdle();
  log(`Run 2: transferred=${state2.transferred} skipped=${state2.skipped}`);
  const files2 = await req('GET', '/files?status=transferred');
  check('IMG nach Lösung übertragen', files2.json.total === 2, files2.json.rows.map((r: any) => r.targetRelPath).join(','));

  const probs2 = await req('GET', '/problems?resolved=true');
  const imgResolved = probs2.json.rows.some(
    (p: any) => p.type === 'DATE_MISMATCH_FILENAME' && p.file?.originalName.startsWith('IMG_')
  );
  check('IMG-Problem gelöst', imgResolved);

  const formats = await req('GET', '/formats');
  const txt = formats.json.find((f: any) => f.ext === 'txt');
  const jpg = formats.json.find((f: any) => f.ext === 'jpg');
  check('Format-Übersicht: txt unsupported, jpg supported', Boolean(txt && !txt.supported && jpg && jpg.supported));

  const dbFile = path.join(DATA, 'mediamanager.db');
  const content = fs.readFileSync(dbFile, 'utf8');
  const hasAbsPath = content.includes(UPLOAD.replace(/\\/g, '/')) || content.includes(BASE.replace(/\\/g, '/'));
  check('Keine absoluten Pfade in DB', !hasAbsPath);

  const thumb = await fetch(`${baseUrl}/api/media/thumbnail/${files2.json.rows[0].id}`);
  check('Thumbnail erzeugt', thumb.status === 200 && thumb.headers.get('content-type')?.includes('image/jpeg'));

  const stats = await req('GET', '/stats');
  check('Stats verfügbar', stats.json.devices === 3 && stats.json.counts.transferred === 2);

  // ---- Target scan + library ----
  // Place an old-style named image directly in the target tree and an identical
  // copy in the upload folder (same content, different name).
  const oldStyle = path.join(FOTOS, '2019', '07 Juli', '2019_07_04', 'IMG_20190704_120000.jpg');
  fs.mkdirSync(path.dirname(oldStyle), { recursive: true });
  const oldImage = path.join(UPLOAD, 'old_upload_copy.jpg');
  await makeImage(oldStyle, 320, 240, { r: 5, g: 120, b: 200 });
  fs.copyFileSync(oldStyle, oldImage);

  // The upload copy must first be indexed by a transfer scan so the target scan can link it.
  await req('POST', '/transfer');
  await waitForIdle();

  const scanStart = await req('POST', '/scan/targets');
  check('Zielordner-Scan startet', scanStart.status === 202);
  await waitForTargetIdle();

  const groups = await req('GET', '/library/groups');
  const has2019 = groups.json.some((g: any) => g.year === 2019 && g.month === 7 && g.day === 4);
  check('Bibliothek: 2019-Gruppe vorhanden', has2019, JSON.stringify(groups.json.slice(0, 5)));

  const lib2019 = await req('GET', '/library?year=2019&month=7&day=4');
  check('Bibliothek: Datei am 04.07.2019', lib2019.json.total === 1 && lib2019.json.rows[0].originalName === 'IMG_20190704_120000.jpg', lib2019.json.rows[0]?.originalName);

  const uploadFiles = await req('GET', '/files?search=old_upload_copy');
  const linked = uploadFiles.json.rows.find((r: any) => r.originalName === 'old_upload_copy.jpg');
  check('Upload-Datei als importiert markiert', linked?.status === 'transferred' && linked?.targetRelPath?.includes('2019/07 Juli/2019_07_04'), linked?.status);

  const libProbs = await req('GET', '/problems?resolved=false');
  const libTypes = libProbs.json.rows.map((p: any) => p.type);
  check('Konsistenzfehler erkannt', libTypes.includes('LIBRARY_FILENAME_FILETIME_MISMATCH'), libTypes.join(','));

  const thumbLib = await fetch(`${baseUrl}/api/media/thumbnail/${lib2019.json.rows[0].id}`);
  check('Bibliothek-Thumbnail erzeugt', thumbLib.status === 200 && thumbLib.headers.get('content-type')?.includes('image/jpeg'));

  const stats2 = await req('GET', '/stats');
  check('Stats nach Scan aktualisiert', stats2.json.counts.transferred >= 4);

  // ---- Unknown device with EXIF info: candidate + adopt ----
  const exifFile = path.join(UPLOAD, 'exifcam_photo.jpg');
  await makeImageExif(exifFile, 'ExifCam', 'ExifCam X1');

  await req('POST', '/transfer');
  await waitForIdle();

  const probs3 = await req('GET', '/problems?resolved=false');
  const hasExifUnknown = probs3.json.rows.some((p: any) => p.type === 'UNKNOWN_DEVICE' && p.file?.originalName === 'exifcam_photo.jpg');
  check('EXIF-Datei erzeugt kein UNKNOWN_DEVICE-Problem', !hasExifUnknown);

  const unknown = await req('GET', '/devices/unknown');
  const cand = unknown.json.find((c: any) => c.identifierValue === 'ExifCam ExifCam X1');
  check('Unbekanntes Gerät wird angeboten', Boolean(cand && cand.count === 1), JSON.stringify(unknown.json));

  const adopt = await req('POST', '/devices/adopt', { mappedName: 'ExifCam', identifierValue: 'ExifCam ExifCam X1' });
  check('Gerät übernommen', adopt.json?.ok === true && adopt.json?.assigned === 1, JSON.stringify(adopt.json));

  const exifFiles = await req('GET', '/files?search=exifcam_photo');
  check('Datei hat Gerät zugeordnet', exifFiles.json.rows[0]?.deviceId != null, String(exifFiles.json.rows[0]?.status));

  await req('POST', '/transfer');
  await waitForIdle();
  const exifFiles2 = await req('GET', '/files?search=exifcam_photo');
  check('EXIF-Datei nach Übernahme übertragen', exifFiles2.json.rows[0]?.status === 'transferred', String(exifFiles2.json.rows[0]?.status));

  // ---- Metadaten-Blob (meta_json) für Analysen ohne Rescan ----
  const exifMeta = exifFiles2.json.rows[0];
  check('Metadaten-Blob gespeichert (Make/Model)', exifMeta?.meta?.Make === 'ExifCam' && exifMeta?.meta?.Model === 'ExifCam X1', JSON.stringify(exifMeta?.meta));

  // ---- Re-scan: already transferred + unchanged files are skipped ----
  const transferredRows = (await req('GET', '/files?status=transferred')).json.rows as any[];
  const uploadTransferred = transferredRows.filter((r: any) => r.sourceRoot === 'upload').length;
  await req('POST', '/transfer');
  const rescanState = await waitForIdle();
  log(`Rescan: scanned=${rescanState.scanned} transferred=${rescanState.transferred} skipped=${rescanState.skipped} uploadTransferred=${uploadTransferred}`);
  check('Bereits übertragene Dateien übersprungen', rescanState.skipped >= uploadTransferred && rescanState.transferred === 0, `skipped=${rescanState.skipped} uploadTransferred=${uploadTransferred}`);

  // ---- Problem re-evaluation (Aktualisieren in der Problemliste) ----
  const recheckStart = await req('POST', '/problems/recheck');
  check('Neubewertung startet', recheckStart.status === 202, String(recheckStart.json?.error));
  const recheckState = await waitForRecheckIdle();
  check('Neubewertung abgeschlossen', recheckState.status === 'completed' && recheckState.total > 0 && recheckState.checked === recheckState.total, JSON.stringify(recheckState));
  const probsAfter = await req('GET', '/problems?resolved=false');
  check('Problemliste nach Neubewertung geladen', probsAfter.json.total > 0 && Array.isArray(probsAfter.json.rows), String(probsAfter.json.total));

  // ---- WhatsApp: Datum kommt aus dem Dateinamen, isWhatsApp-Flag gesetzt ----
  await req('POST', '/devices', { mappedName: 'WhatsAppCam', identifiers: [{ kind: 'filename', value: 'IMG-' }] });
  await makeImage(path.join(UPLOAD, 'IMG-20210102-WA0001.jpg'), 320, 320, { r: 120, g: 200, b: 200 });

  await req('POST', '/transfer');
  await waitForIdle();

  const waFiles = await req('GET', '/files?search=IMG-20210102');
  const wf = waFiles.json.rows[0];
  check('WhatsApp-Datei erkannt und übertragen', wf?.isWhatsApp === true && wf?.status === 'transferred', `isWhatsApp=${wf?.isWhatsApp} status=${wf?.status}`);
  check('WhatsApp-Datum aus Dateinamen', wf?.takenAt?.startsWith('2021-01-02'), wf?.takenAt);
  check('WhatsApp-Zielpfad in Januar 2021', wf?.targetRelPath?.includes('2021/01 Januar/2021_01_02'), wf?.targetRelPath);

  // ---- Path-basiertes Gerät: Person + Ordner-Identifikator ----
  const pathFolder = path.join(UPLOAD, 'Guido', 'Sony Alpha 6400');
  fs.mkdirSync(pathFolder, { recursive: true });
  await makeImage(path.join(pathFolder, 'DSC_0001.jpg'), 400, 300, { r: 200, g: 20, b: 30 });

  await req('POST', '/transfer');
  await waitForIdle();

  const pathProbs = await req('GET', '/problems?resolved=false');
  const hasPathProblem = pathProbs.json.rows.some((p: any) => p.file?.sourceRelPath?.includes('Sony Alpha 6400'));
  check('Pfad-Datei erzeugt kein Problem', !hasPathProblem);

  const unknown2 = await req('GET', '/devices/unknown');
  const pathCand = unknown2.json.find((c: any) => c.identifierKind === 'path');
  check('Pfad-Kandidat vorgeschlagen', Boolean(pathCand && pathCand.identifierValue === 'Guido/Sony Alpha 6400' && pathCand.person === 'Guido' && pathCand.count === 1), JSON.stringify(pathCand));

  const adoptPath = await req('POST', '/devices/adopt', { mappedName: 'Sony Alpha 6400', identifierKind: 'path', identifierValue: 'Guido/Sony Alpha 6400', person: 'Guido' });
  check('Pfad-Gerät mit Person übernommen', adoptPath.json?.ok === true && adoptPath.json?.assigned === 1, JSON.stringify(adoptPath.json));

  await req('POST', '/transfer');
  await waitForIdle();

  const pathFiles = await req('GET', '/files?search=DSC_0001');
  const pf = pathFiles.json.rows[0];
  check('Pfad-Datei übertragen mit Person', pf?.status === 'transferred' && pf?.devicePerson === 'Guido' && pf?.targetRelPath?.includes('Sony Alpha 6400 von Guido'), pf?.targetRelPath);

  // ---- Datei-Erstellzeit: Vergleich + Änderungszeit >= Erstellzeit ----
  const birthFile = path.join(UPLOAD, 'PXL_birthtest.jpg');
  await makeImage(birthFile, 400, 300, { r: 20, g: 200, b: 200 });
  // mtime künstlich in die Vergangenheit setzen → mtime < birthtime (Erstellzeit = jetzt)
  const old = new Date(2020, 0, 15, 10, 0, 0);
  fs.utimesSync(birthFile, old, old);

  await req('POST', '/transfer');
  await waitForIdle();

  const birthProbs = await req('GET', '/problems?resolved=false');
  const birthProblem = birthProbs.json.rows.find((p: any) => p.type === 'FILE_MTIME_BEFORE_BIRTHTIME' && p.file?.originalName === 'PXL_birthtest.jpg');
  check('Änderungszeit < Erstellzeit wird erkannt', Boolean(birthProblem), birthProblem?.message);

  const birthRec = (await req('GET', '/files?search=PXL_birthtest')).json.rows[0];
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  check('Datum aus Erstellzeit statt Änderungszeit', birthRec?.dateSource === 'file' && birthRec?.takenAt?.startsWith(todayKey), `takenAt=${birthRec?.takenAt} erwartet=${todayKey}`);

  // ---- Geräte aus Zielordnern: EXIF-Kandidat aus der Bibliothek ----
  const libCamDir = path.join(FOTOS, '2018', '03 März', '2018_03_10');
  fs.mkdirSync(libCamDir, { recursive: true });
  const libCamFile = path.join(libCamDir, '20180310_SC_0012.jpg');
  await makeImageExif(libCamFile, 'LibCam', 'LibCam Y2');

  const libScan = await req('POST', '/scan/targets');
  check('Zielordner-Scan startet (LibCam)', libScan.status === 202, String(libScan.json?.error));
  await waitForTargetIdle();

  const unknown3 = await req('GET', '/devices/unknown');
  const libCand = unknown3.json.find((c: any) => c.identifierValue === 'LibCam LibCam Y2');
  check('Bibliotheks-Gerät wird als Kandidat angeboten', Boolean(libCand && libCand.count === 1), JSON.stringify(libCand));

  const adoptLib = await req('POST', '/devices/adopt', { mappedName: 'LibCam Y2', identifierValue: 'LibCam LibCam Y2' });
  check('Bibliotheks-Gerät übernommen', adoptLib.json?.ok === true && adoptLib.json?.assigned === 1, JSON.stringify(adoptLib.json));

  const libRec = (await req('GET', '/library?year=2018&month=3&day=10')).json.rows[0];
  check('Bibliotheks-Datei hat Gerät zugeordnet', libRec?.deviceId != null && libRec?.deviceMappedName === 'LibCam Y2', `${libRec?.deviceMappedName} (${libRec?.originalName})`);
  check('Bibliotheks-Metadaten-Blob gespeichert', libRec?.meta?.Make === 'LibCam' && libRec?.meta?.Model === 'LibCam Y2', JSON.stringify(libRec?.meta));

  // ---- Indikator zu einem BESTEHENDEN Gerät hinzufügen ----
  const addFile = path.join(UPLOAD, 'addcam_shot.jpg');
  await makeImageExif(addFile, 'AddCam', 'AddCam M1');
  await req('POST', '/transfer');
  await waitForIdle();

  const devicesList = (await req('GET', '/devices')).json as any[];
  const pixel = devicesList.find((d: any) => d.mappedName === 'Pixel8');
  check('Bestehendes Gerät gefunden', Boolean(pixel), devicesList.map((d: any) => d.mappedName).join(','));

  const unknown4 = await req('GET', '/devices/unknown');
  const addCand = unknown4.json.find((c: any) => c.identifierValue === 'AddCam AddCam M1');
  check('Kandidat liefert Beispiel-Datei-ID', Boolean(addCand && addCand.sampleFileId != null), JSON.stringify(addCand));

  const adoptAdd = await req('POST', '/devices/adopt', { deviceId: pixel.id, identifierValue: 'AddCam AddCam M1' });
  check('Indikator zu bestehendem Gerät hinzugefügt', adoptAdd.json?.ok === true && adoptAdd.json?.added === true && adoptAdd.json?.assigned === 1, JSON.stringify(adoptAdd.json));

  const addFiles = await req('GET', '/files?search=addcam_shot');
  const addRec = addFiles.json.rows[0];
  check('Datei gehört jetzt dem bestehenden Gerät', addRec?.deviceId === pixel.id && addRec?.deviceMappedName === 'Pixel8', `${addRec?.deviceId}`);

  const pixelDev = await req('GET', `/devices/${pixel.id}`);
  check('Identifikator am Gerät hinterlegt', pixelDev.json.identifiers.some((i: any) => i.value === 'AddCam AddCam M1'), JSON.stringify(pixelDev.json.identifiers));

  const pixelFiles = await req('GET', `/devices/${pixel.id}/files`);
  check('Geräteseite listet zugehörige Dateien', pixelFiles.json.some((f: any) => f.originalName === 'addcam_shot.jpg'), pixelFiles.json.map((f: any) => f.originalName).join(','));

  const idFiles = await req('GET', `/files?identifierKind=exif&identifierValue=${encodeURIComponent('AddCam AddCam M1')}`);
  check('Identifikator-Seite listet Dateien', idFiles.json.total >= 1 && idFiles.json.rows.some((f: any) => f.originalName === 'addcam_shot.jpg'), String(idFiles.json.total));

  const fileDetail = await req('GET', `/files/${addRec.id}`);
  check('Datei-Detail liefert Probleme mit', fileDetail.json.id === addRec.id && Array.isArray(fileDetail.json.problems), String(fileDetail.json.problems?.length));

  // ---- Abort: laufender Transfer wird abgebrochen ----
  const abortDir = path.join(UPLOAD, 'abort');
  fs.mkdirSync(abortDir, { recursive: true });
  for (let i = 0; i < 6000; i++) {
    fs.writeFileSync(path.join(abortDir, `f_${String(i).padStart(5, '0')}.txt`), `datei ${i}\n`);
  }
  const abortStart = await req('POST', '/transfer');
  check('Abort-Transfer startet', abortStart.status === 202, String(abortStart.json?.error));
  const abortReq = await req('POST', '/transfer/abort');
  check('Abort angefordert', abortReq.json?.ok === true, String(abortReq.json?.error));
  const abortState = await waitForIdle();
  check('Transfer wird abgebrochen', abortState.status === 'aborted', `status=${abortState.status} scanned=${abortState.scanned}`);
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  try {
    if (server) await new Promise((res) => server!.close(res));
    const { closeDb } = await import('../src/db/database.ts');
    closeDb();
  } catch { /* ignore */ }
  if (!failed && !results.some((r) => !r.ok)) { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* ignore */ } }
}

const allOk = results.every((r) => r.ok) && !failed;
console.log(`\n${allOk ? 'ALLE TESTS BESTANDEN' : 'TESTS FEHLGESCHLAGEN'} (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(allOk ? 0 : 1);