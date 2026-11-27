#!/usr/bin/env python3
"""Put text keys into server/core/data/i18n/{en,es}.json safely while others do the same: a lock, keys replaced in place
or appended before the closing brace, one line per key (plural objects stay on one line), temp file then rename.
Usage: tools/i18n_put.py patch.json   where patch.json is {"en": {"key": value, ...}, "es": {...}}"""
import fcntl, json, os, sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server", "core", "data", "i18n")
patch = json.load(open(sys.argv[1], encoding="utf-8"))
if set(patch) - {"en", "es"} or set(patch.get("en", {})) != set(patch.get("es", {})):
    sys.exit("patch needs the same keys under en and es")
with open(os.path.join(root, ".lock"), "w") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    for lang, keys in patch.items():
        path = os.path.join(root, f"{lang}.json")
        lines = open(path, encoding="utf-8").read().split("\n")
        for k, v in keys.items():
            line = f' "{k}": ' + json.dumps(v, ensure_ascii=False)
            hits = [i for i, l in enumerate(lines) if l.startswith(f' "{k}": ')]
            if hits:
                i = hits[0]
                lines[i] = line + ("," if lines[i].rstrip().endswith(",") else "")
            else:
                end = max(i for i, l in enumerate(lines) if l.strip() == "}")
                lines[end - 1] = lines[end - 1].rstrip().rstrip(",") + ","
                lines.insert(end, line)
        text = "\n".join(lines)
        json.loads(text)
        open(path + ".tmp", "w", encoding="utf-8").write(text)
        os.replace(path + ".tmp", path)
print("ok")
