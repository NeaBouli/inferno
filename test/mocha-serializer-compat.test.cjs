const assert = require("node:assert/strict");

describe("Mocha parallel serializer compatibility", function () {
  it("runs a test file through Mocha's parallel worker pool", function () {
    assert.equal(process.env.MOCHA_WORKER_ID !== undefined, true);
  });
});
