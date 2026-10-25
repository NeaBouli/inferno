const assert = require("node:assert/strict");
const serialize = require("serialize-javascript");
const Ajv = require("ajv");
const uri = require("fast-uri");

describe("Mocha parallel serializer compatibility", function () {
  it("runs a test file through Mocha's parallel worker pool", function () {
    assert.equal(process.env.MOCHA_WORKER_ID !== undefined, true);
  });

  it("mirrors worker-pool serializeOptions for ordinary values", function () {
    // mocha/lib/nodejs/buffered-worker-pool.cjs::serializeOptions uses
    // { unsafe: true, ignoreFunction: true } for worker options.
    const out = serialize(
      { title: "worker result", fn: function ignored() {} },
      { unsafe: true, ignoreFunction: true }
    );
    assert.equal(out, '{"title":"worker result"}');
  });

  it("escapes a spoofed function toString ending with bare </script", function () {
    // Regression for GHSA-m5mm-p8h7-m29v (serialize-javascript < 7.1.3).
    // Synthetic local fixture only; the serialized source is never evaluated.
    for (const source of [
      "function spoofed(){}</script",
      "function spoofed(){ return 1 }//</script"
    ]) {
      const spoofed = function () {};
      spoofed.toString = () => source;
      const compact = serialize({ f: spoofed });
      const pretty = serialize({ nested: { f: spoofed } }, { space: 2 });
      for (const out of [compact, pretty]) {
        assert.equal(/<\/script/i.test(out), false);
        assert.equal(out.includes("function spoofed()"), true);
      }
    }
  });

  it("serializes trusted primitive, Date, RegExp and function values", function () {
    function add(a, b) {
      return a + b;
    }
    const input = {
      s: "ordinary text",
      n: 42,
      d: new Date("2026-01-02T03:04:05.000Z"),
      r: /ab+c/gi,
      f: add
    };
    const out = serialize(input);
    assert.equal(out.includes('"ordinary text"'), true);
    assert.equal(out.includes("42"), true);
    assert.equal(out.includes('new Date("2026-01-02T03:04:05.000Z")'), true);
    assert.equal(out.includes("function add"), true);
    const roundTrip = eval("(" + out + ")"); // trusted local fixture only
    assert.equal(roundTrip.s, "ordinary text");
    assert.equal(roundTrip.n, 42);
    assert.equal(roundTrip.d.getTime(), input.d.getTime());
    assert.equal(String(roundTrip.r), "/ab+c/gi");
    assert.equal(roundTrip.f(2, 3), 5);
  });

  it("rejects malformed URI hosts and preserves an ordinary HTTPS host", function () {
    for (const input of [
      "http://a@b@evil.example/",
      "https://exa\tmple.test/"
    ]) {
      assert.equal(uri.parse(input).error, "URI host is malformed.");
    }
    const ordinary = uri.parse("https://example.test/a");
    assert.equal(ordinary.error, undefined);
    assert.equal(ordinary.host, "example.test");
    assert.equal(ordinary.path, "/a");
  });

  it("resolves local Ajv $id/$ref schemas without a network loader", function () {
    // Control for the ajv 8.18.0 -> fast-uri URI-resolution path.
    const ajv = new Ajv();
    ajv.addSchema({
      $id: "urn:local:dependency-gates:defs",
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      additionalProperties: false
    });
    const validate = ajv.compile({
      $id: "urn:local:dependency-gates:main",
      $ref: "urn:local:dependency-gates:defs"
    });
    assert.equal(validate({ id: 7 }), true);
    assert.equal(validate({ id: "7" }), false);
    assert.equal(validate({}), false);
  });
});
