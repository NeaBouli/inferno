#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly IMAGE='docker.io/library/node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402'
readonly DIGEST='sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402'
readonly OWNER_LABEL='org.inferno.forum-fixture.owner'
readonly CONTAINER_PATH='/usr/local/bin:/usr/bin:/bin'
readonly PASS_LINE='FORUM_FIXTURE_TESTS_PASS synthetic-only ADVISORY productionReady=false chainEvidenceVerified=false'

refuse() { printf '%s\n' 'FORUM_CI_REFUSED'; exit 98; }

docker_cmd() {
  /usr/bin/timeout --signal=TERM --kill-after="${COMMAND_KILL_AFTER:-5}s" "${COMMAND_TIMEOUT:?}s" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C \
    /usr/bin/docker --host=unix:///var/run/docker.sock --config "$OWN/docker-config" "$@"
}

check_host() {
  local tool
  for tool in bash docker env timeout head stat mkdir mktemp readlink chmod rm cmp curl; do
    [[ -x "/usr/bin/$tool" ]] || refuse
  done
  [[ ${BASH_VERSINFO[0]} -ge 5 && -S /var/run/docker.sock ]] || refuse
  [[ "$OWN" =~ ^/tmp/forum-fixture\.[A-Za-z0-9]{6}$ && -d "$OWN" && ! -L "$OWN" ]] || refuse
}

# Every captured command has a byte cap and deadline; raw target output is not published.
capture() {
  local name=$1 limit=$2 seconds=$3 size
  shift 3
  case "$1" in docker_cmd|exec_clean|exec_target) ;; *) refuse ;; esac
  local -a results
  set +e
  COMMAND_TIMEOUT=$seconds "$@" 2>&1 \
    | /usr/bin/head -c "$((limit + 1))" >"$OWN/$name"
  results=("${PIPESTATUS[@]}")
  set -e
  size=$(/usr/bin/stat -c '%s' -- "$OWN/$name")
  TEXT_BYTES=$((TEXT_BYTES + size))
  [[ $size -le $limit && $TEXT_BYTES -le 49152 && ${results[1]} -eq 0 ]] || refuse
  CAPTURE_STATUS=${results[0]}
}

must_capture() {
  capture "$@"
  [[ $CAPTURE_STATUS -eq 0 ]] || refuse
}

exec_clean() {
  local container=$1 home=$2
  shift 2
  docker_cmd exec "$container" /usr/bin/env -i PATH="$CONTAINER_PATH" \
    HOME="$home" TMPDIR=/tmp LANG=C LC_ALL=C "$@"
}

exec_target() {
  docker_cmd exec "$TARGET_ID" /usr/bin/env -i PATH="$CONTAINER_PATH" \
    HOME=/tmp/home TMPDIR=/tmp LANG=C LC_ALL=C NODE_PATH=/tools/node_modules "$@"
}

IFS= read -r -d '' PREFLIGHT <<'JS' || :
"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const [phase, owner, work, volume, ...hostNamespaces] = process.argv.slice(1);
const expected = new Map([
  ["@adraffy/ens-normalize", "1.11.1"], ["@noble/curves", "1.2.0"],
  ["@noble/hashes", "1.3.2"], ["@types/node", "22.7.5"],
  ["aes-js", "4.0.0-beta.5"], ["ethers", "6.17.0"],
  ["tslib", "2.7.0"], ["undici-types", "6.19.8"], ["ws", "8.21.0"],
]);
const digest = "sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402";
const imageRef = `docker.io/library/node@${digest}`;
const root = phase === "acquire" ? "/work" : "/tools/node_modules";
function mountRows() {
  return new Map(fs.readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map(line => {
    const fields = line.split(" ");
    const split = fields.indexOf("-");
    assert(split > 5);
    return [fields[4], { flags: fields[5].split(","), type: fields[split + 1] }];
  }));
}
function tree(rootPath, seal) {
  assert.deepEqual(fs.readdirSync(rootPath).sort(),
    ["@adraffy", "@noble", "@types", "aes-js", "ethers", "tslib", "undici-types", "ws"].sort());
  for (const scope of ["@adraffy", "@noble", "@types"]) {
    assert.deepEqual(fs.readdirSync(`${rootPath}/${scope}`).sort(),
      [...expected.keys()].filter(name => name.startsWith(`${scope}/`)).map(name => name.split("/")[1]).sort());
  }
  let count = 0;
  let bytes = 0;
  function walk(path, depth) {
    assert(depth <= 16 && ++count <= 8192);
    const stat = fs.lstatSync(path);
    assert(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()));
    assert(stat.uid === 10000 && stat.gid === 10000);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(path)) {
        assert(/^[A-Za-z0-9_.@+-]+$/.test(name) && name !== "." && name !== ".." && name !== "node_modules");
        walk(`${path}/${name}`, depth + 1);
      }
      if (seal) fs.chmodSync(path, 0o555);
    } else {
      assert(stat.size <= 8388608 && stat.nlink === 1);
      bytes += stat.size;
      assert(bytes <= 33554432);
      if (seal) fs.chmodSync(path, 0o444);
    }
    if (!seal) assert((stat.mode & 0o222) === 0);
  }
  walk(rootPath, 0);
  for (const [name, version] of expected) {
    const pkg = JSON.parse(fs.readFileSync(`${rootPath}/${name}/package.json`, "utf8"));
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, version);
  }
}
async function main() {
  assert(["acquire", "target"].includes(phase));
  assert.equal(process.version, "v22.23.3");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.getuid(), 10000);
  assert.equal(process.getgid(), 10000);
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: phase === "acquire" ? "/work/home" : "/tmp/home",
    TMPDIR: "/tmp", LANG: "C", LC_ALL: "C" };
  assert.deepEqual({ ...process.env }, env);
  const firstEnv = Object.fromEntries(fs.readFileSync("/proc/1/environ", "utf8").split("\0")
    .filter(Boolean).map(entry => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
  assert.deepEqual(firstEnv, env);
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    assert(Buffer.byteLength(input) <= 32768);
  }
  const objects = JSON.parse(input);
  assert.equal(objects.length, 2);
  const [image, container] = objects;
  assert.equal(image.Os, "linux");
  assert.equal(image.Architecture, "amd64");
  assert(image.RepoDigests.includes(`node@${digest}`) || image.RepoDigests.includes(imageRef));
  assert.equal(container.Image, image.Id);
  assert.equal(container.Config.Image, imageRef);
  assert.equal(container.Config.User, "10000:10000");
  assert.equal(container.Config.Labels["org.inferno.forum-fixture.owner"], owner);
  assert.equal(container.Config.WorkingDir, "/");
  assert.equal(container.Config.Tty, false);
  assert.equal(container.Config.OpenStdin, false);
  assert.deepEqual(container.Config.Entrypoint, ["/usr/bin/env"]);
  const lifetime = phase === "acquire" ? 180000 : 240000;
  assert.deepEqual(container.Config.Cmd, ["-i", ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    "/usr/local/bin/node", "-e", `setInterval(() => {}, 1000); setTimeout(() => process.exit(98), ${lifetime})`]);
  assert(container.State.Running && !container.State.OOMKilled);
  const h = container.HostConfig;
  assert.equal(h.NetworkMode, "none");
  assert.equal(h.IpcMode, "none");
  assert.equal(h.PidMode, "");
  assert.equal(h.CgroupnsMode, "private");
  assert.equal(h.Privileged, false);
  assert.equal(h.ReadonlyRootfs, true);
  assert.deepEqual(h.CapDrop, ["ALL"]);
  assert(!h.CapAdd || h.CapAdd.length === 0);
  assert.deepEqual(h.SecurityOpt, ["no-new-privileges=true"]);
  assert.equal(h.NanoCpus, 1000000000);
  const memory = phase === "acquire" ? 536870912 : 268435456;
  const fileSize = phase === "acquire" ? 8388608 : 1048576;
  assert.equal(h.Memory, memory);
  assert.equal(h.MemorySwap, memory);
  assert.equal(h.PidsLimit, 64);
  for (const key of ["Binds", "VolumesFrom", "Devices", "DeviceRequests", "ExtraHosts", "Links", "GroupAdd"]) {
    assert(!h[key] || h[key].length === 0);
  }
  assert(!h.PortBindings || Object.keys(h.PortBindings).length === 0);
  assert(!h.Sysctls || Object.keys(h.Sysctls).length === 0);
  assert.equal(h.PublishAllPorts, false);
  assert.equal(h.Runtime, "runc");
  assert.equal(h.LogConfig.Type, "none");
  assert.equal(h.Ulimits.length, 2);
  for (const [name, value] of [["nofile", 64], ["fsize", fileSize]]) {
    const setting = h.Ulimits.find(item => item.Name === name);
    assert(setting && setting.Soft === value && setting.Hard === value);
  }
  assert.deepEqual(h.Tmpfs, { "/tmp": "rw,noexec,nosuid,nodev,size=16777216,mode=0700,uid=10000,gid=10000" });
  const binds = new Map([
    ["/etc/hosts", `${work}/injected/hosts`], ["/etc/hostname", `${work}/injected/hostname`],
    ["/etc/resolv.conf", `${work}/injected/resolv.conf`],
    ...(phase === "acquire" ? [["/work/package.json", `${work}/inputs/package.json`],
      ["/work/package-lock.json", `${work}/inputs/package-lock.json`]] : [["/source/scripts", `${work}/source`]]),
  ]);
  const configured = h.Mounts;
  assert.equal(configured.length, binds.size + 1);
  for (const mount of configured) {
    if (mount.Type === "volume") {
      assert.equal(mount.Source, volume);
      assert.equal(mount.Target, root);
      assert.equal(Boolean(mount.ReadOnly), phase === "target");
      assert.equal(mount.VolumeOptions.NoCopy, true);
      assert.equal(mount.VolumeOptions.Subpath || "", phase === "target" ? "node_modules" : "");
    } else {
      assert.equal(mount.Type, "bind");
      assert.equal(mount.Source, binds.get(mount.Target));
      assert.equal(mount.ReadOnly, true);
      assert.equal(mount.BindOptions.Propagation, "rprivate");
      binds.delete(mount.Target);
    }
  }
  assert.equal(binds.size, 0);
  const rows = mountRows();
  assert(rows.get("/").flags.includes("ro"));
  assert(rows.get(root).flags.includes(phase === "acquire" ? "rw" : "ro"));
  assert.equal(rows.get(root).type, "tmpfs");
  for (const flag of ["noexec", "nosuid", "nodev"]) assert(rows.get(root).flags.includes(flag));
  for (const path of ["/etc/hosts", "/etc/hostname", "/etc/resolv.conf",
    ...(phase === "acquire" ? ["/work/package.json", "/work/package-lock.json"] : ["/source/scripts"])]) {
    assert(rows.get(path).flags.includes("ro"));
  }
  for (const path of ["/tmp", root]) {
    const stat = fs.statfsSync(path, { bigint: true });
    assert.equal(stat.type, 0x01021994n);
    assert.equal(stat.blocks * stat.bsize, path === "/tmp" ? 16777216n : 134217728n);
  }
  for (const flag of ["rw", "noexec", "nosuid", "nodev"]) assert(rows.get("/tmp").flags.includes(flag));
  const scratch = fs.statSync("/tmp");
  assert.equal(scratch.uid, 10000);
  assert.equal(scratch.gid, 10000);
  assert.equal(scratch.mode & 0o777, 0o700);
  assert(!fs.existsSync("/dev/shm") || !rows.has("/dev/shm"));
  assert(!fs.existsSync("/var/run/docker.sock") && !fs.existsSync("/run/docker.sock"));
  for (const pid of ["self", "1"]) {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    for (const key of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
      assert(new RegExp(`^${key}:\\s+0+$`, "m").test(status));
    }
    assert(/^Seccomp:\s+2$/m.test(status));
    assert(/^NoNewPrivs:\s+1$/m.test(status));
    const limits = fs.readFileSync(`/proc/${pid}/limits`, "utf8");
    assert(/^Max open files\s+64\s+64\s+files$/m.test(limits));
    assert(new RegExp(`^Max file size\\s+${fileSize}\\s+${fileSize}\\s+bytes$`, "m").test(limits));
  }
  for (const [index, name] of ["net", "ipc", "pid", "mnt", "cgroup"].entries()) {
    assert(hostNamespaces[index] && fs.readlinkSync(`/proc/self/ns/${name}`) !== hostNamespaces[index]);
    assert.equal(fs.readlinkSync(`/proc/self/ns/${name}`), fs.readlinkSync(`/proc/1/ns/${name}`));
  }
  assert.deepEqual(fs.readdirSync("/sys/class/net"), ["lo"]);
  assert.equal(fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim(), String(memory));
  assert.equal(fs.readFileSync("/sys/fs/cgroup/memory.swap.max", "utf8").trim(), "0");
  assert.equal(fs.readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim(), "64");
  const [quota, period] = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(" ");
  assert(/^\d+$/.test(quota) && /^\d+$/.test(period) && BigInt(quota) > 0n && BigInt(quota) === BigInt(period));
  if (phase === "target") {
    assert.deepEqual(fs.readdirSync("/source/scripts").sort(), ["test-forum-votes.cjs", "verify-forum-votes.cjs"]);
    for (const name of fs.readdirSync("/source/scripts")) {
      const stat = fs.lstatSync(`/source/scripts/${name}`);
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144);
    }
    tree(root, false);
    fs.mkdirSync("/tmp/home", { mode: 0o700 });
    assert.deepEqual(fs.readdirSync("/tmp/home"), []);
  } else {
    for (const directory of ["/work/home", "/work/cache"]) {
      assert(!fs.existsSync(directory));
      fs.mkdirSync(directory, { mode: 0o700 });
      assert.deepEqual(fs.readdirSync(directory), []);
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    }
    for (const config of ["/work/user.npmrc", "/work/global.npmrc"]) {
      fs.writeFileSync(config, "", { flag: "wx", mode: 0o600 });
    }
  }
  process.stdout.write("FORUM_PREFLIGHT_CONTROLS_OK\n");
}
main().catch(() => { process.stdout.write("FORUM_PREFLIGHT_REFUSED\n"); process.exitCode = 98; });
JS

IFS= read -r -d '' LOCK_PLAN <<'JS' || :
"use strict";
try {
  const fs = require("node:fs");
  const assert = require("node:assert/strict");
  const expected = new Map([
    ["@adraffy/ens-normalize", "1.11.1"], ["@noble/curves", "1.2.0"],
    ["@noble/hashes", "1.3.2"], ["@types/node", "22.7.5"],
    ["aes-js", "4.0.0-beta.5"], ["ethers", "6.17.0"],
    ["tslib", "2.7.0"], ["undici-types", "6.19.8"], ["ws", "8.21.0"],
  ]);
  const manifest = JSON.parse(fs.readFileSync("/work/package.json", "utf8"));
  const lock = JSON.parse(fs.readFileSync("/work/package-lock.json", "utf8"));
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(manifest.dependencies, { ethers: "^6.15.0" });
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(manifest.engines.node, ">=20 <23");
  const packages = Object.entries(lock.packages).filter(([name, pkg]) => name !== "" && !pkg.dev);
  assert.equal(packages.length, expected.size);
  let index = 0;
  for (const [path, pkg] of packages.sort(([left], [right]) => left.localeCompare(right, "en"))) {
    assert(path.startsWith("node_modules/") && !pkg.link && !pkg.hasInstallScript);
    const name = path.slice("node_modules/".length);
    assert.equal(pkg.version, expected.get(name));
    const base = name.split("/").at(-1);
    assert.equal(pkg.resolved, `https://registry.npmjs.org/${name}/-/${base}-${pkg.version}.tgz`);
    assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity));
    assert(!pkg.optional && !pkg.inBundle);
    process.stdout.write(`${index++}|${pkg.resolved}|${pkg.integrity}\n`);
  }
} catch { process.stdout.write("FORUM_LOCK_REFUSED\n"); process.exitCode = 98; }
JS

IFS= read -r -d '' STORE_TARBALL <<'JS' || :
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
async function main() {
  const [index, integrity] = process.argv.slice(1);
  assert(/^[0-8]$/.test(index) && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity));
  fs.mkdirSync("/work/archives", { recursive: true, mode: 0o700 });
  const path = `/work/archives/${index}.tgz`;
  const fd = fs.openSync(path, "wx", 0o600);
  const hash = crypto.createHash("sha512");
  let size = 0;
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      assert(size <= 8388608);
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
    }
  } finally { fs.closeSync(fd); }
  assert(size > 0 && `sha512-${hash.digest("base64")}` === integrity);
  process.stdout.write("FORUM_TARBALL_INTEGRITY_OK\n");
}
main().catch(() => { process.stdout.write("FORUM_TARBALL_REFUSED\n"); process.exitCode = 98; });
JS

IFS= read -r -d '' SEAL_CLOSURE <<'JS' || :
"use strict";
try {
  const fs = require("node:fs");
  const assert = require("node:assert/strict");
  const root = "/work/node_modules";
  const expected = new Map([
    ["@adraffy/ens-normalize", "1.11.1"], ["@noble/curves", "1.2.0"],
    ["@noble/hashes", "1.3.2"], ["@types/node", "22.7.5"],
    ["aes-js", "4.0.0-beta.5"], ["ethers", "6.17.0"],
    ["tslib", "2.7.0"], ["undici-types", "6.19.8"], ["ws", "8.21.0"],
  ]);
  if (fs.existsSync(`${root}/.package-lock.json`)) fs.unlinkSync(`${root}/.package-lock.json`);
  assert.deepEqual(fs.readdirSync(root).sort(),
    ["@adraffy", "@noble", "@types", "aes-js", "ethers", "tslib", "undici-types", "ws"].sort());
  for (const scope of ["@adraffy", "@noble", "@types"]) {
    assert.deepEqual(fs.readdirSync(`${root}/${scope}`).sort(),
      [...expected.keys()].filter(name => name.startsWith(`${scope}/`)).map(name => name.split("/")[1]).sort());
  }
  let count = 0;
  let bytes = 0;
  function seal(path, depth) {
    assert(depth <= 16 && ++count <= 8192);
    const stat = fs.lstatSync(path);
    assert(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()));
    assert(stat.uid === 10000 && stat.gid === 10000);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(path)) {
        assert(/^[A-Za-z0-9_.@+-]+$/.test(name) && name !== "." && name !== ".." && name !== "node_modules");
        seal(`${path}/${name}`, depth + 1);
      }
      fs.chmodSync(path, 0o555);
    } else {
      assert(stat.size <= 8388608 && stat.nlink === 1);
      bytes += stat.size;
      assert(bytes <= 33554432);
      fs.chmodSync(path, 0o444);
    }
  }
  seal(root, 0);
  for (const [name, version] of expected) {
    const pkg = JSON.parse(fs.readFileSync(`${root}/${name}/package.json`, "utf8"));
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, version);
  }
  process.stdout.write("FORUM_CLOSURE_SEALED ethers=6.17.0\n");
} catch { process.stdout.write("FORUM_CLOSURE_REFUSED\n"); process.exitCode = 98; }
JS

IFS= read -r -d '' IMPORT_CHECK <<'JS' || :
"use strict";
try {
  const fs = require("node:fs");
  const assert = require("node:assert/strict");
  const resolved = fs.realpathSync(require.resolve("ethers"));
  assert(resolved.startsWith("/tools/node_modules/ethers/"));
  assert.equal(require("ethers").version, "6.17.0");
  const api = require("/source/scripts/verify-forum-votes.cjs");
  assert.deepEqual(Object.keys(api), ["verifyFixture"]);
  assert.equal(typeof api.verifyFixture, "function");
  process.stdout.write("FORUM_IMPORT_OK ethers=6.17.0\n");
} catch { process.stdout.write("FORUM_IMPORT_REFUSED\n"); process.exitCode = 98; }
JS

verify_line() {
  local name=$1 expected=$2
  printf '%s\n' "$expected" >"$OWN/expected"
  /usr/bin/cmp -s -- "$OWN/$name" "$OWN/expected" || refuse
}

stage_file() {
  local source=$1 dest=$2 limit=$3
  [[ -f "$source" && ! -L "$source" ]] || refuse
  /usr/bin/head -c "$((limit + 1))" -- "$source" >"$dest"
  [[ $(/usr/bin/stat -c '%s' -- "$dest") -le $limit ]] || refuse
  /usr/bin/chmod 0444 -- "$dest"
}

create_container() {
  local phase=$1 name=$2 home=$3 memory=$4 file_size=$5
  local lifetime=240000
  local -a mounts=(
    --mount "type=bind,source=$OWN/injected/hosts,target=/etc/hosts,readonly,bind-propagation=rprivate"
    --mount "type=bind,source=$OWN/injected/hostname,target=/etc/hostname,readonly,bind-propagation=rprivate"
    --mount "type=bind,source=$OWN/injected/resolv.conf,target=/etc/resolv.conf,readonly,bind-propagation=rprivate"
  )
  if [[ "$phase" == acquire ]]; then
    lifetime=180000
    mounts+=(
      --mount "type=volume,source=$VOLUME,target=/work,volume-nocopy"
      --mount "type=bind,source=$OWN/inputs/package.json,target=/work/package.json,readonly,bind-propagation=rprivate"
      --mount "type=bind,source=$OWN/inputs/package-lock.json,target=/work/package-lock.json,readonly,bind-propagation=rprivate"
    )
  else
    mounts+=(
      --mount "type=volume,source=$VOLUME,target=/tools/node_modules,readonly,volume-nocopy,volume-subpath=node_modules"
      --mount "type=bind,source=$OWN/source,target=/source/scripts,readonly,bind-propagation=rprivate"
    )
  fi
  must_capture "$phase-create" 256 15 docker_cmd create --pull=never --platform=linux/amd64 \
    --name "$name" --label "$OWNER_LABEL=$OWNER" --network=none --ipc=none --cgroupns=private \
    --read-only --user=10000:10000 --workdir=/ --runtime=runc --cap-drop=ALL --security-opt=no-new-privileges=true \
    --cpus=1 --memory="$memory" --memory-swap="$memory" --pids-limit=64 \
    --ulimit=nofile=64:64 --ulimit="fsize=$file_size:$file_size" --log-driver=none \
    --tmpfs '/tmp:rw,noexec,nosuid,nodev,size=16777216,mode=0700,uid=10000,gid=10000' \
    "${mounts[@]}" --entrypoint=/usr/bin/env "$IMAGE" -i PATH="$CONTAINER_PATH" \
    HOME="$home" TMPDIR=/tmp LANG=C LC_ALL=C /usr/local/bin/node -e \
    "setInterval(() => {}, 1000); setTimeout(() => process.exit(98), $lifetime)"
  IFS= read -r CREATED_ID <"$OWN/$phase-create"
  [[ "$CREATED_ID" =~ ^[a-f0-9]{64}$ ]] || refuse
  printf '%s\n' "$CREATED_ID" >"$OWN/$phase-id"
  must_capture "$phase-start" 256 15 docker_cmd start "$CREATED_ID"
}

preflight() {
  local phase=$1 id=$2 home=$3
  must_capture "$phase-inspect" 32768 10 docker_cmd inspect "$IMAGE" "$id"
  must_capture "$phase-preflight" 256 15 docker_cmd exec -i "$id" /usr/bin/env -i \
    PATH="$CONTAINER_PATH" HOME="$home" TMPDIR=/tmp LANG=C LC_ALL=C \
    /usr/local/bin/node -e "$PREFLIGHT" "$phase" "$OWNER" "$OWN" "$VOLUME" "${HOST_NS[@]}" \
    <"$OWN/$phase-inspect"
  verify_line "$phase-preflight" 'FORUM_PREFLIGHT_CONTROLS_OK'
}

remaining_acquisition() {
  local requested=$1
  ACQ_REMAINING=$((ACQ_DEADLINE - SECONDS))
  [[ $ACQ_REMAINING -gt 0 ]] || refuse
  if (( ACQ_REMAINING > requested )); then ACQ_REMAINING=$requested; fi
}

fetch_one() {
  local index=$1 url=$2 integrity=$3 seconds=$4
  local -a results
  set +e
  /usr/bin/timeout --signal=TERM --kill-after=5s "${seconds}s" \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C \
    /usr/bin/curl --disable --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --max-redirs 0 --retry 0 --connect-timeout 10 --max-time "$seconds" --max-filesize 8388608 \
    --proxy '' --noproxy '*' --fail --silent --url "$url" \
    | /usr/bin/timeout --signal=TERM --kill-after=5s "${seconds}s" \
      /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C \
      /usr/bin/docker --host=unix:///var/run/docker.sock --config "$OWN/docker-config" \
      exec -i "$ACQ_ID" /usr/bin/env -i PATH="$CONTAINER_PATH" HOME=/work/home TMPDIR=/tmp LANG=C LC_ALL=C \
      /usr/local/bin/node -e "$STORE_TARBALL" "$index" "$integrity" 2>&1 \
    | /usr/bin/head -c 257 >"$OWN/tarball-$index"
  results=("${PIPESTATUS[@]}")
  set -e
  local size
  size=$(/usr/bin/stat -c '%s' -- "$OWN/tarball-$index")
  TEXT_BYTES=$((TEXT_BYTES + size))
  [[ $size -le 256 && $TEXT_BYTES -le 49152 && ${results[0]} -eq 0 && ${results[1]} -eq 0 && ${results[2]} -eq 0 ]] || refuse
  verify_line "tarball-$index" 'FORUM_TARBALL_INTEGRITY_OK'
}

child_main() {
  check_host
  TEXT_BYTES=0
  CAPTURE_STATUS=0
  OWNER=${OWN##*/}
  VOLUME="$OWNER-tools"
  local script_dir root ns index url integrity extra count=0
  script_dir=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
  root=${script_dir%/scripts}
  /usr/bin/mkdir -- "$OWN/inputs" "$OWN/source" "$OWN/injected"
  stage_file "$root/apps/sdk/package.json" "$OWN/inputs/package.json" 16384
  stage_file "$root/apps/sdk/package-lock.json" "$OWN/inputs/package-lock.json" 16384
  stage_file "$root/scripts/verify-forum-votes.cjs" "$OWN/source/verify-forum-votes.cjs" 262144
  stage_file "$root/scripts/test-forum-votes.cjs" "$OWN/source/test-forum-votes.cjs" 262144
  printf '127.0.0.1 localhost\n' >"$OWN/injected/hosts"
  printf 'forum-fixture\n' >"$OWN/injected/hostname"
  printf '# No network or resolver\n' >"$OWN/injected/resolv.conf"
  /usr/bin/chmod 0444 -- "$OWN/injected/hosts" "$OWN/injected/hostname" "$OWN/injected/resolv.conf"
  /usr/bin/chmod 0755 -- "$OWN/source"
  HOST_NS=()
  for ns in net ipc pid mnt cgroup; do HOST_NS+=("$(/usr/bin/readlink "/proc/self/ns/$ns")"); done
  must_capture engine 1024 10 docker_cmd info --format '{{.CgroupVersion}}|{{json .SecurityOptions}}'
  [[ $(<"$OWN/engine") == 2\|* && $(<"$OWN/engine") == *'name=seccomp,profile=builtin'* ]] || refuse
  must_capture image-pull 4096 120 docker_cmd pull --platform=linux/amd64 "$IMAGE"
  must_capture volume-existing 256 10 docker_cmd volume ls --filter "name=^$VOLUME$" --format '{{.Name}}'
  [[ ! -s "$OWN/volume-existing" ]] || refuse
  must_capture volume-create 256 10 docker_cmd volume create --driver=local --label "$OWNER_LABEL=$OWNER" \
    --opt type=tmpfs --opt device=tmpfs --opt 'o=size=134217728,uid=10000,gid=10000,mode=0700,nosuid,nodev,noexec' "$VOLUME"
  verify_line volume-create "$VOLUME"
  must_capture volume-proof 1024 10 docker_cmd volume inspect --format \
    '{{.Name}}|{{.Driver}}|{{index .Labels "org.inferno.forum-fixture.owner"}}|{{index .Options "type"}}|{{index .Options "device"}}|{{index .Options "o"}}' "$VOLUME"
  verify_line volume-proof "$VOLUME|local|$OWNER|tmpfs|tmpfs|size=134217728,uid=10000,gid=10000,mode=0700,nosuid,nodev,noexec"
  printf '%s\n' "$VOLUME" >"$OWN/volume-id"
  ACQ_DEADLINE=$((SECONDS + 180))
  create_container acquire "$OWNER-acquire" /work/home 536870912 8388608
  ACQ_ID=$CREATED_ID
  preflight acquire "$ACQ_ID" /work/home
  remaining_acquisition 10
  must_capture lock-plan 4096 "$ACQ_REMAINING" exec_clean "$ACQ_ID" /work/home /usr/local/bin/node -e "$LOCK_PLAN"
  while IFS='|' read -r index url integrity extra; do
    [[ "$index" == "$count" && -z "$extra" && "$url" == https://registry.npmjs.org/* ]] || refuse
    [[ "$integrity" =~ ^sha512-[A-Za-z0-9+/]{86}==$ ]] || refuse
    remaining_acquisition 30
    fetch_one "$index" "$url" "$integrity" "$ACQ_REMAINING"
    remaining_acquisition 15
    must_capture "cache-$index" 2048 "$ACQ_REMAINING" exec_clean "$ACQ_ID" /work/home \
      /usr/local/bin/npm --userconfig=/work/user.npmrc --globalconfig=/work/global.npmrc --cache=/work/cache \
      --offline --ignore-scripts --no-audit --no-fund --update-notifier=false --loglevel=error \
      cache add "/work/archives/$index.tgz"
    count=$((count + 1))
  done <"$OWN/lock-plan"
  [[ $count -eq 9 ]] || refuse
  remaining_acquisition 60
  must_capture npm-ci 4096 "$ACQ_REMAINING" exec_clean "$ACQ_ID" /work/home \
    /usr/local/bin/npm --userconfig=/work/user.npmrc --globalconfig=/work/global.npmrc --cache=/work/cache --prefix=/work \
    --offline --omit=dev --ignore-scripts --no-audit --no-fund --update-notifier=false --loglevel=error ci
  remaining_acquisition 15
  must_capture closure 256 "$ACQ_REMAINING" exec_clean "$ACQ_ID" /work/home /usr/local/bin/node -e "$SEAL_CLOSURE"
  verify_line closure 'FORUM_CLOSURE_SEALED ethers=6.17.0'
  remaining_acquisition 1

  # Keep the tmpfs volume mounted through handoff, then remove its sole writable container.
  create_container target "$OWNER-target" /tmp/home 268435456 1048576
  TARGET_ID=$CREATED_ID
  must_capture acquire-remove 256 10 docker_cmd rm --force "$ACQ_ID"
  must_capture acquire-remaining 256 10 docker_cmd container ls --all --no-trunc \
    --filter "label=$OWNER_LABEL=$OWNER" --filter "name=^/$OWNER-acquire$" --format '{{.ID}}'
  [[ ! -s "$OWN/acquire-remaining" ]] || refuse
  preflight target "$TARGET_ID" /tmp/home
  must_capture import 256 30 exec_target /usr/local/bin/node -e "$IMPORT_CHECK"
  verify_line import 'FORUM_IMPORT_OK ethers=6.17.0'
  capture cli 1024 30 exec_target /usr/local/bin/node /source/scripts/verify-forum-votes.cjs
  [[ $CAPTURE_STATUS -eq 1 ]] || refuse
  verify_line cli '{"profile":"synthetic-only","authority":"ADVISORY","productionReady":false,"chainEvidenceVerified":false,"status":"refused","error":"OFFLINE_API_ONLY"}'
  must_capture fixture 1024 120 exec_target /usr/local/bin/node /source/scripts/test-forum-votes.cjs
  verify_line fixture "$PASS_LINE"
  printf '%s\n' 'FORUM_CI_CHECKS_COMPLETE'
}

# Cleanup operates on exact names plus this invocation's label, never shared resources.
cleanup_capture() {
  local name=$1 seconds size
  shift
  seconds=$((CLEANUP_DEADLINE - SECONDS))
  (( seconds > 0 )) || return 1
  if (( seconds > 10 )); then seconds=10; fi
  local -a results
  COMMAND_TIMEOUT=$seconds COMMAND_KILL_AFTER=2 "$@" 2>&1 \
    | /usr/bin/head -c 2049 >"$OWN/cleanup-$name"
  results=("${PIPESTATUS[@]}")
  size=$(/usr/bin/stat -c '%s' -- "$OWN/cleanup-$name") || return 1
  CLEANUP_BYTES=$((CLEANUP_BYTES + size))
  [[ $size -le 2048 && $CLEANUP_BYTES -le 12288 && ${results[0]} -eq 0 && ${results[1]} -eq 0 ]]
}

cleanup_owned() {
  local id name extra expected phase bad=0 owner=${OWN##*/}
  CLEANUP_BYTES=0
  CLEANUP_DEADLINE=$((SECONDS + 50))
  if cleanup_capture containers docker_cmd container ls --all --no-trunc \
    --filter "label=$OWNER_LABEL=$owner" --format '{{.ID}}|{{.Names}}'; then
    while IFS='|' read -r id name extra; do
      [[ -n "$id" ]] || continue
      if [[ "$id" =~ ^[a-f0-9]{64}$ && -z "$extra" && ( "$name" == "$owner-acquire" || "$name" == "$owner-target" ) ]]; then
        phase=${name##*-}
        expected=''
        if [[ -f "$OWN/$phase-id" && ! -L "$OWN/$phase-id" ]]; then
          IFS= read -r expected <"$OWN/$phase-id"
        fi
        if [[ "$expected" == "$id" ]]; then
          cleanup_capture "remove-$name" docker_cmd rm --force "$id" || bad=1
        else
          bad=1
        fi
      else
        bad=1
      fi
    done <"$OWN/cleanup-containers"
  else
    bad=1
  fi
  cleanup_capture remaining-containers docker_cmd container ls --all \
    --filter "label=$OWNER_LABEL=$owner" --format '{{.ID}}' || bad=1
  [[ ! -s "$OWN/cleanup-remaining-containers" ]] || bad=1
  if cleanup_capture volumes docker_cmd volume ls --filter "label=$OWNER_LABEL=$owner" --format '{{.Name}}'; then
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      if [[ "$name" == "$owner-tools" ]]; then
        expected=''
        if [[ -f "$OWN/volume-id" && ! -L "$OWN/volume-id" ]]; then
          IFS= read -r expected <"$OWN/volume-id"
        fi
        if [[ "$expected" == "$name" ]]; then
          cleanup_capture remove-volume docker_cmd volume rm "$name" || bad=1
        else
          bad=1
        fi
      else
        bad=1
      fi
    done <"$OWN/cleanup-volumes"
  else
    bad=1
  fi
  cleanup_capture remaining-volumes docker_cmd volume ls \
    --filter "label=$OWNER_LABEL=$owner" --format '{{.Name}}' || bad=1
  [[ ! -s "$OWN/cleanup-remaining-volumes" ]] || bad=1
  return "$bad"
}

finish() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  if ! cleanup_owned; then
    printf '%s\n' 'FORUM_CI_CLEANUP_UNCONFIRMED'
    status=1
  fi
  if [[ "$OWN" =~ ^/tmp/forum-fixture\.[A-Za-z0-9]{6}$ && -d "$OWN" && ! -L "$OWN" ]]; then
    /usr/bin/timeout --signal=TERM --kill-after=2s 5s /usr/bin/rm -r -- "$OWN"
    if [[ $? -ne 0 || -e "$OWN" ]]; then
      printf '%s\n' 'FORUM_CI_TEMP_CLEANUP_UNCONFIRMED'
      status=1
    fi
  else
    status=1
  fi
  if [[ $status -eq 0 ]]; then
    printf '%s\n' 'FORUM_CI_PASS synthetic-only ADVISORY productionReady=false chainEvidenceVerified=false'
  else
    printf '%s\n' 'FORUM_CI_FAIL'
  fi
  exit "$status"
}

if [[ $# -eq 2 && $1 == --bounded-child ]]; then
  OWN=$2
  child_main
elif [[ $# -eq 0 ]]; then
  [[ -x /usr/bin/mktemp && -x /usr/bin/timeout && -x /usr/bin/head ]] || refuse
  OWN=$(/usr/bin/mktemp -d /tmp/forum-fixture.XXXXXX)
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  check_host
  /usr/bin/mkdir -- "$OWN/docker-config"
  set +e
  /usr/bin/timeout --signal=TERM --kill-after=10s 540s \
    /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C \
    /usr/bin/bash --noprofile --norc "${BASH_SOURCE[0]}" --bounded-child "$OWN" 2>&1 \
    | /usr/bin/head -c 4097 >"$OWN/child-output"
  results=("${PIPESTATUS[@]}")
  set -e
  [[ ${results[0]} -eq 0 && ${results[1]} -eq 0 && $(/usr/bin/stat -c '%s' -- "$OWN/child-output") -le 4096 ]] || refuse
  printf '%s\n' 'FORUM_CI_CHECKS_COMPLETE' >"$OWN/expected-child-output"
  /usr/bin/cmp -s -- "$OWN/child-output" "$OWN/expected-child-output" || refuse
else
  refuse
fi
