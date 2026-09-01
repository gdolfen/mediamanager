import type { Device } from '../types.js';
import { findDeviceByIdentifier, listDevices } from '../db/daos.js';

let deviceCache: Device[] | null = null;

/** Cache devices for the duration of a scan phase to avoid re-querying per file. */
export function cacheDevices(): void { deviceCache = listDevices(); }
export function clearDeviceCache(): void { deviceCache = null; }

export interface DeviceResolution {
  device: Device | null;
  /** Human readable raw identifier that was (or would be) used. */
  raw: string | null;
  matchedBy: 'exif' | 'filename' | 'path' | null;
}

export interface PathDeviceInfo {
  /** Relative directory within the upload root, e.g. "Guido/Sony Alpha 6400". */
  relDir: string | null;
  /** Folder name used as device name (last path segment). */
  deviceName: string | null;
  /** First path segment, if the folder is nested (person). */
  person: string | null;
}

/** Parse person/device from the relative directory of an upload file. */
export function pathDeviceInfo(relDir: string): PathDeviceInfo {
  const segments = relDir.split('/').filter(Boolean);
  if (segments.length === 0) return { relDir: null, deviceName: null, person: null };
  return {
    relDir,
    deviceName: segments[segments.length - 1],
    person: segments.length >= 2 ? segments[0] : null,
  };
}

export function exifIdentifier(make: string | null, model: string | null): string | null {
  if (!make && !model) return null;
  return `${make ?? ''} ${model ?? ''}`.replace(/\s+/g, ' ').trim();
}

/** Match a device by EXIF/QuickTime Make+Model. */
export function resolveByExif(make: string | null, model: string | null): DeviceResolution {
  const raw = exifIdentifier(make, model);
  if (!raw) return { device: null, raw: null, matchedBy: null };
  const device = findDeviceByIdentifier('exif', raw);
  return { device, raw, matchedBy: device ? 'exif' : null };
}

/** Match a device by filename prefix identifiers. */
export function resolveByFilename(filename: string): DeviceResolution {
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase();
  const devices = deviceCache ?? listDevices();
  for (const device of devices) {
    for (const ident of device.identifiers) {
      if (ident.kind !== 'filename') continue;
      const value = ident.value.toLowerCase();
      if (base.startsWith(value)) {
        return { device, raw: ident.value, matchedBy: 'filename' };
      }
    }
  }
  return { device: null, raw: null, matchedBy: null };
}

/** Match a device by the upload folder structure (fallback when EXIF is missing). */
export function resolveByPath(relDir: string): { resolution: DeviceResolution; info: PathDeviceInfo } {
  const info = pathDeviceInfo(relDir);
  if (!info.relDir) return { resolution: { device: null, raw: null, matchedBy: null }, info };
  // Try the full folder first, then walk upwards so files in sub-folders
  // (e.g. "Guido/Sony Alpha 6400/DCIM/...") still match the assigned device.
  const segments = relDir.split('/').filter(Boolean);
  for (let i = segments.length; i >= 1; i--) {
    const candidate = segments.slice(0, i).join('/');
    const device = findDeviceByIdentifier('path', candidate);
    if (device) return { resolution: { device, raw: candidate, matchedBy: 'path' }, info };
  }
  return { resolution: { device: null, raw: info.relDir, matchedBy: null }, info };
}

/**
 * Resolve the device for a file: EXIF first, then filename prefix, then upload path.
 * Returns the resolution plus the effective raw identifier.
 */
export function resolveDevice(opts: {
  filename: string;
  exifMake: string | null;
  exifModel: string | null;
  exifRaw: string | null;
  relDir: string;
}): DeviceResolution & { pathInfo: PathDeviceInfo } {
  const exifRes = resolveByExif(opts.exifMake, opts.exifModel);
  if (exifRes.device) return { ...exifRes, pathInfo: { relDir: null, deviceName: null, person: null } };
  const fnRes = resolveByFilename(opts.filename);
  if (fnRes.device) return { ...fnRes, pathInfo: { relDir: null, deviceName: null, person: null } };
  const pathRes = resolveByPath(opts.relDir);
  if (pathRes.resolution.device) {
    const device = pathRes.resolution.device;
    // Persist person from the folder when the device has none yet.
    return { device, raw: pathRes.resolution.raw, matchedBy: 'path', pathInfo: pathRes.info };
  }
  const raw = exifRes.raw ?? opts.exifRaw ?? fnRes.raw ?? pathRes.info.relDir;
  return { device: null, raw, matchedBy: null, pathInfo: pathRes.info };
}

/** Display name of a device: "<Gerät> von <Person>" when a person is assigned. */
export function deviceDisplayName(d: Device): string {
  return d.person ? `${d.mappedName} von ${d.person}` : d.mappedName;
}