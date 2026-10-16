/**
 * Sensitive-field encryption and real file-type detection (no database, no packages needed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { decryptField, encryptField, isEncryptionConfigured, lastFour, maskValue } from "../src/helpers/fieldcrypto.helper.js";
import { detectFileType } from "../src/helpers/filetype.helper.js";

test("encryption round-trips, uses a fresh IV each time and detects tampering", () => {
  process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  assert.equal(isEncryptionConfigured(), true);
  const first = encryptField("123456789012");
  const second = encryptField("123456789012");
  assert.notEqual(first, second);
  assert.equal(decryptField(first), "123456789012");
  assert.ok(!first.includes("123456789012"));
  const [version, iv, tag, data] = first.split(":");
  const tampered = [version, iv, tag, Buffer.from("x" + Buffer.from(data, "base64").toString("latin1"), "latin1").toString("base64")].join(":");
  assert.throws(() => decryptField(tampered));
});

test("a missing key refuses to encrypt instead of storing plain text", () => {
  const saved = process.env.FIELD_ENCRYPTION_KEY;
  delete process.env.FIELD_ENCRYPTION_KEY;
  assert.equal(isEncryptionConfigured(), false);
  assert.throws(() => encryptField("ABCDE1234F"), /not configured/);
  process.env.FIELD_ENCRYPTION_KEY = saved;
});

test("masking shows only the last 4 characters", () => {
  assert.equal(maskValue(lastFour("123456789012"), 12), "XXXXXXXX9012");
  assert.equal(maskValue(null), null);
});

test("file type comes from the bytes, not the name", () => {
  assert.equal(detectFileType(Buffer.from("%PDF-1.7\n...")), "application/pdf");
  assert.equal(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), "image/png");
  assert.equal(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), "image/jpeg");
  assert.equal(detectFileType(Buffer.from("MZ\x90\x00 this is an exe renamed to .pdf")), null);
  assert.equal(detectFileType(Buffer.from("<svg onload=alert(1)>")), null);
  assert.equal(detectFileType("not a buffer"), null);
});
