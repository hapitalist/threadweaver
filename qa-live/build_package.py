"""Build the VoltBuilder package from this repo and compare it, file by file, with the last package that
the stores accepted. Nothing is uploaded; it prints the comparison and refuses to build if anything that
must never ship inside the app is in it.

  python3 build_package.py <signing_dir> <accepted_zip> <out_zip>

signing_dir holds certificates/ and voltbuilder.json (never in git). accepted_zip is the last build that
reached the stores (its certificates and voltbuilder.json must match ours, or the upload/signing breaks).
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, zipfile

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
# never inside the app (www/ is compiled into the app and can be extracted from it)
KEEP_OUT_OF_WWW = {"qa-review-notes.json", "package.json", "package-lock.json", "qa-behavior.mjs", "qa-clicktest.mjs",
                   "compliance_ledger.py", "compliance_ledger.txt", ".qa-run.mjs"}
ROOT_EXTRAS = {"qa-review-notes.json"}   # moved to the package root: the validator reads it, the app never contains it

def sha(p): return hashlib.sha1(open(p, "rb").read()).hexdigest()
def tree(root):
    out = {}
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f); out[os.path.relpath(p, root)] = sha(p)
    return out

def main(signing, accepted_zip, out_zip):
    if os.path.exists(out_zip): sys.exit("refusing to overwrite " + out_zip)
    stage = tempfile.mkdtemp(prefix="twpkg_")
    shutil.copytree(os.path.join(REPO, "www"), os.path.join(stage, "www"),
                    ignore=lambda d, names: [n for n in names if os.path.normpath(d) == os.path.join(REPO, "www") and n in KEEP_OUT_OF_WWW])
    for d in ("res", "resources"): shutil.copytree(os.path.join(REPO, d), os.path.join(stage, d))
    shutil.copy(os.path.join(REPO, "config.xml"), stage)
    shutil.copytree(os.path.join(signing, "certificates"), os.path.join(stage, "certificates"))
    shutil.copy(os.path.join(signing, "voltbuilder.json"), stage)
    for f in ROOT_EXTRAS:
        src = os.path.join(REPO, "www", f)
        if os.path.exists(src): shutil.copy(src, stage)
    leaked = [f for f in KEEP_OUT_OF_WWW if os.path.exists(os.path.join(stage, "www", f))]
    if leaked: sys.exit("BLOCKED: would ship inside the app: " + ", ".join(leaked))
    # validator, run inside the package exactly as it will be zipped
    r = subprocess.run([sys.executable, "-I", "scan.py"], cwd=os.path.join(stage, "www"), capture_output=True, text=True)
    verdict = [l for l in r.stdout.splitlines() if l.startswith("RESULT")][-1:]
    print("validator inside the package:", verdict[0] if verdict else "no verdict", "(exit %d)" % r.returncode)
    if r.returncode != 0: sys.exit("BLOCKED: validator failed\n" + "\n".join(l for l in r.stdout.splitlines() if "FAIL" in l))
    # compare with the accepted build
    acc = tempfile.mkdtemp(prefix="twacc_")
    zipfile.ZipFile(accepted_zip).extractall(acc)
    o, n = tree(acc), tree(stage)
    ignore_old = {"_headers", "_redirects"}   # website-only files an old upload carried; VoltBuilder ignores them
    added = sorted(set(n) - set(o)); removed = sorted(set(o) - set(n) - ignore_old)
    changed = sorted(k for k in set(o) & set(n) if o[k] != n[k])
    print(f"\nCOMPARED WITH THE ACCEPTED BUILD ({os.path.basename(accepted_zip)}): {len(o)} -> {len(n)} files")
    print("  added:  ", added or "none"); print("  removed:", removed or "none"); print("  changed:", changed or "none")
    for k in ("voltbuilder.json",):
        same = o.get(k) == n.get(k); print(f"  {k}: {'IDENTICAL' if same else 'DIFFERENT'}")
        if not same:
            jo, jn = json.load(open(os.path.join(acc, k))), json.load(open(os.path.join(stage, k)))
            print("    fields that differ:", sorted(x for x in set(jo) | set(jn) if jo.get(x) != jn.get(x)))
    certs = sorted(k for k in o if k.startswith("certificates/"))
    print("  certificates:", "IDENTICAL" if all(o.get(k) == n.get(k) for k in certs) and certs == sorted(k for k in n if k.startswith("certificates/")) else "DIFFERENT", certs)
    co, cn = open(os.path.join(acc, "config.xml")).read(), open(os.path.join(stage, "config.xml")).read()
    vo = re.search(r'version="([^"]+)" ios-CFBundleVersion="(\d+)" android-versionCode="(\d+)"', co).groups()
    vn = re.search(r'version="([^"]+)" ios-CFBundleVersion="(\d+)" android-versionCode="(\d+)"', cn).groups()
    print(f"  version: {vo[0]} ({vo[1]}) -> {vn[0]} ({vn[1]})", "OK" if int(vn[1]) > int(vo[1]) and vn[1] == vn[2] else "PROBLEM: build number must go up")
    so, sn = re.search(r'<content src="([^"]+)"', co).group(1), re.search(r'<content src="([^"]+)"', cn).group(1)
    print(f"  start page: {so} -> {sn}")
    strip = lambda t: re.sub(r'<content src="[^"]+"', '', re.sub(r'version="[^"]+" ios-CFBundleVersion="\d+" android-versionCode="\d+"', '', t))
    print("  config.xml apart from version/start page:", "IDENTICAL" if strip(co) == strip(cn) else "DIFFERENT")
    # zip
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for d, _, fs in os.walk(stage):
            for f in sorted(fs):
                p = os.path.join(d, f); z.write(p, os.path.relpath(p, stage))
    names = zipfile.ZipFile(out_zip).namelist()
    print(f"\nbuilt {out_zip} ({os.path.getsize(out_zip)//1024} KB, {len(names)} files); review notes inside www/: {'www/qa-review-notes.json' in names}")
    shutil.rmtree(stage); shutil.rmtree(acc)

if __name__ == "__main__":
    if len(sys.argv) != 4: sys.exit(__doc__)
    main(*sys.argv[1:])
