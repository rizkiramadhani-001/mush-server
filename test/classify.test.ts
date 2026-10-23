import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "../src/classify.ts";

test("suhu dan kelembapan dalam target", () => {
  const result = classify(41.2, 62);
  assert.equal(result.target, true);
  assert.equal(result.status, "dalam_target");
  assert.equal(result.mlLabel, "Asam laktat");
});

test("batas target tetap dianggap dalam target", () => {
  assert.equal(classify(40, 55).status, "dalam_target");
  assert.equal(classify(45, 70).status, "dalam_target");
});

test("suhu di atas target", () => {
  const result = classify(46, 62);
  assert.equal(result.status, "di_luar_target");
  assert.equal(result.tone, "bad");
  assert.equal(result.mlLabel, "Anomali: cek udara");
});

test("suhu di bawah target", () => {
  const result = classify(38, 62);
  assert.equal(result.status, "di_luar_target");
  assert.equal(result.mlLabel, "Awal fermentasi");
});

test("kelembapan di luar target dengan suhu normal", () => {
  const result = classify(42, 75);
  assert.equal(result.status, "di_luar_target");
  assert.equal(result.tone, "warn");
  assert.equal(result.mlLabel, "Perlu perhatian");
});
