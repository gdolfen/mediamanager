import { z } from 'zod';

export const identifierKindSchema = z.enum(['exif', 'filename', 'path']);

export const deviceIdentifierSchema = z.object({
  kind: identifierKindSchema,
  value: z.string().min(1).max(200),
});

export const deviceSchema = z.object({
  mappedName: z.string().min(1).max(100),
  person: z.string().max(100).nullable().optional(),
  identifiers: z.array(deviceIdentifierSchema).max(50).default([]),
});

export const settingsSchema = z.object({
  paths: z.object({
    upload: z.string().min(1).max(2000),
    fotos: z.string().min(1).max(2000),
    videos: z.string().min(1).max(2000),
  }),
});

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(24 * 60),
  mode: z.enum(['scan', 'scan_and_transfer']),
});