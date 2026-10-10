"use strict";

// Source only: future execution requires separate admission in a confined runner.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const shellPath = path.join(__dirname, "run-forum-fixture-ci.sh");
const shellSource = readFileSync(shellPath, "utf8");
const begin = "// PROC_LIMIT_ASSERTION_BEGIN";
const end = "// PROC_LIMIT_ASSERTION_END";
assert.equal(shellSource.split(begin).length, 2, "one helper begin marker required");
assert.equal(shellSource.split(end).length, 2, "one helper end marker required");
const start = shellSource.indexOf(begin) + begin.length;
const finish = shellSource.indexOf(end);
assert(finish > start, "helper markers must be ordered");

// Evaluate only the marked production helper, never the shell or its preflight.
const assertProcLimitRow = vm.runInNewContext(
  shellSource.slice(start, finish) + "\nassertProcLimitRow;",
  { assert },
  { filename: shellPath + "#PROC_LIMIT_ASSERTION", timeout: 1000 }
);
assert.equal(typeof assertProcLimitRow, "function");

const limits = [
  { name: "open files", label: "Max open files", value: 64, units: "files" },
  { name: "target file size", label: "Max file size", value: 1048576, units: "bytes" },
  { name: "acquisition file size", label: "Max file size", value: 8388608, units: "bytes" }
];

function row(limit, soft = limit.value, hard = limit.value, units = limit.units) {
  return `${limit.label} ${soft} ${hard} ${units}`;
}

function paddedRow(limit) {
  return limit.label.padEnd(26) + String(limit.value).padEnd(21) +
    String(limit.value).padEnd(21) + limit.units.padEnd(10);
}

const forbiddenWhitespace = [
  ["CR", "\r"],
  ["vertical tab", "\u000b"],
  ["form feed", "\u000c"],
  ["next line", "\u0085"],
  ["NBSP", "\u00a0"],
  ["Ogham space", "\u1680"],
  ["en quad", "\u2000"],
  ["em quad", "\u2001"],
  ["en space", "\u2002"],
  ["em space", "\u2003"],
  ["three-per-em space", "\u2004"],
  ["four-per-em space", "\u2005"],
  ["six-per-em space", "\u2006"],
  ["figure space", "\u2007"],
  ["punctuation space", "\u2008"],
  ["thin space", "\u2009"],
  ["hair space", "\u200a"],
  ["zero-width space", "\u200b"],
  ["U+2028 line separator", "\u2028"],
  ["U+2029 paragraph separator", "\u2029"],
  ["narrow NBSP", "\u202f"],
  ["medium mathematical space", "\u205f"],
  ["ideographic space", "\u3000"],
  ["BOM", "\ufeff"]
];

for (const limit of limits) {
  const { name, label, value, units } = limit;
  const canonical = row(limit);
  const accepted = [
    ["canonical column padding", paddedRow(limit)],
    ["single ASCII gaps without trailing padding", canonical],
    ["tabs without trailing padding", `${label}\t${value}\t${value}\t${units}`],
    ["tabs with trailing padding", `${label}\t${value}\t${value}\t${units}\t\t`],
    ["mixed spaces and tabs", `${label} \t ${value}\t  ${value} \t${units} \t `],
    ["final LF", canonical + "\n"],
    ["blank lines", "\n" + canonical + "\n\n"],
    ["unrelated rows", "Limit Soft Hard Units\nMax cpu time unlimited unlimited seconds\n" + canonical]
  ];
  for (const [boundary, text] of accepted) {
    test(`${name}: accepts ${boundary}`, () => {
      assert.doesNotThrow(() => assertProcLimitRow(text, label, value, units));
    });
  }

  const refused = [
    ["empty input", ""],
    ["missing row", "Limit Soft Hard Units\nMax cpu time unlimited unlimited seconds"],
    ["wrong soft below bound", row(limit, value - 1)],
    ["wrong soft above bound", row(limit, value + 1)],
    ["wrong hard below bound", row(limit, value, value - 1)],
    ["wrong hard above bound", row(limit, value, value + 1)],
    ["both values wrong", row(limit, value + 1, value + 1)],
    ["zero soft", row(limit, 0)],
    ["negative hard", row(limit, value, -1)],
    ["unlimited soft", row(limit, "unlimited")],
    ["unlimited hard", row(limit, value, "unlimited")],
    ["unlimited both", row(limit, "unlimited", "unlimited")],
    ["leading-zero soft", row(limit, "0" + value)],
    ["leading-zero hard", row(limit, value, "0" + value)],
    ["explicit positive sign", row(limit, "+" + value)],
    ["decimal spelling", row(limit, value + ".0")],
    ["exponent spelling", row(limit, value, value + "e0")],
    ["hex spelling", row(limit, "0x" + value.toString(16))],
    ["numeric suffix", row(limit, value, value + "x")],
    ["wrong unit", row(limit, value, value, units === "files" ? "bytes" : "files")],
    ["singular unit", row(limit, value, value, units.slice(0, -1))],
    ["unit case mismatch", row(limit, value, value, units.toUpperCase())],
    ["unit suffix", canonical + "x"],
    ["extra field", canonical + " extra"],
    ["extra field after padding", paddedRow(limit) + "extra"],
    ["missing all fields", label],
    ["missing hard value", `${label} ${value} ${units}`],
    ["missing units", `${label} ${value} ${value}`],
    ["missing first gap", `${label}${value} ${value} ${units}`],
    ["missing second gap", `${label} ${value}${value} ${units}`],
    ["missing third gap", `${label} ${value} ${value}${units}`],
    ["soft on next line", `${label}\n${value} ${value} ${units}`],
    ["hard on next line", `${label} ${value}\n${value} ${units}`],
    ["units on next line", `${label} ${value} ${value}\n${units}`],
    ["leading space", " " + canonical],
    ["leading tab", "\t" + canonical],
    ["label case mismatch", row({ ...limit, label: label.toUpperCase() })],
    ["label embedded in another row", "Other " + canonical],
    ["malformed prefix suffix", `${label}Suffix ${value} ${value} ${units}`],
    ["CRLF", canonical + "\r\n"],
    ["padded CRLF", paddedRow(limit) + "\r\n"]
  ];
  for (const [boundary, text] of refused) {
    test(`${name}: refuses ${boundary}`, () => {
      assert.throws(() => assertProcLimitRow(text, label, value, units), {
        code: "ERR_ASSERTION"
      });
    });
  }

  for (const [character, whitespace] of forbiddenWhitespace) {
    const positions = [
      ["before label", whitespace + canonical],
      ["within label", row({ ...limit, label: label.replace(" ", whitespace) })],
      ["first gap", `${label}${whitespace}${value} ${value} ${units}`],
      ["second gap", `${label} ${value}${whitespace}${value} ${units}`],
      ["third gap", `${label} ${value} ${value}${whitespace}${units}`],
      ["after units", canonical + whitespace],
      ["after ASCII padding", canonical + " \t " + whitespace],
      ["before ASCII padding", canonical + whitespace + " \t "],
      ["before LF", canonical + " \t " + whitespace + "\n"]
    ];
    for (const [position, text] of positions) {
      test(`${name}: refuses ${character} ${position}`, () => {
        assert.throws(() => assertProcLimitRow(text, label, value, units), {
          code: "ERR_ASSERTION"
        });
      });
    }
  }

  const duplicates = [
    ["canonical duplicate", canonical],
    ["padded duplicate", paddedRow(limit)],
    ["wrong-value duplicate", row(limit, value + 1)],
    ["wrong-unit duplicate", row(limit, value, value, "wrong")],
    ["bare label", label],
    ["label suffix without separator", `${label}Suffix ${value} ${value} ${units}`],
    ["label followed by colon", label + ": malformed"],
    ["label followed by tab and malformed fields", label + "\tmalformed"],
    ["label followed by NBSP", label + "\u00a0malformed"],
    ["next-line fields", `${label}\n${value} ${value} ${units}`],
    ["extra-field duplicate", canonical + " extra"],
    ["CR-terminated duplicate", canonical + "\r"],
    ["U+2028-terminated duplicate", canonical + "\u2028"],
    ["NBSP-terminated duplicate", canonical + "\u00a0"]
  ];
  for (const [boundary, duplicate] of duplicates) {
    for (const order of ["before", "after"]) {
      const text = (order === "before" ? [duplicate, canonical] : [canonical, duplicate]).join("\n");
      test(`${name}: refuses ${boundary} ${order} valid row`, () => {
        assert.throws(() => assertProcLimitRow(text, label, value, units), {
          code: "ERR_ASSERTION",
          message: "exactly one process-limit row required"
        });
      });
    }
  }

  test(`${name}: accepts caller's exact alternate finite bound`, () => {
    assert.doesNotThrow(() => assertProcLimitRow(row(limit, value + 1, value + 1), label, value + 1, units));
  });
  test(`${name}: refuses original values for a different caller bound`, () => {
    assert.throws(() => assertProcLimitRow(canonical, label, value + 1, units), {
      code: "ERR_ASSERTION"
    });
  });
}

for (const fileLimit of limits.slice(1)) {
  const otherPhase = limits.find(limit => limit.label === fileLimit.label && limit.value !== fileLimit.value);
  test(`${fileLimit.name}: refuses the other phase's finite bound`, () => {
    assert.throws(() => assertProcLimitRow(row(otherPhase), fileLimit.label, fileLimit.value, fileLimit.units), {
      code: "ERR_ASSERTION"
    });
  });
  for (const order of ["files first", "file size first"]) {
    const rows = [paddedRow(limits[0]), paddedRow(fileLimit)];
    if (order === "file size first") rows.reverse();
    const text = "Limit Soft Hard Units\n" + rows.join("\n") + "\n";
    test(`${fileLimit.name}: accepts both expected rows together, ${order}`, () => {
      for (const limit of [limits[0], fileLimit]) {
        assert.doesNotThrow(() => assertProcLimitRow(text, limit.label, limit.value, limit.units));
      }
    });
  }
}
