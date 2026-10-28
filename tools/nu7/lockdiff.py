# List every Cargo.lock package entry that changed, except the NU7-patched ones.
import sys,re
def pk(f):
    out={}
    for b in open(f).read().split('[[package]]')[1:]:
        out[(re.search(r'name = "([^"]+)"',b).group(1),re.search(r'version = "([^"]+)"',b).group(1))]=b.strip()
    return out
a,b=pk(sys.argv[1]),pk(sys.argv[2])
patched=set()
for c in sys.argv[3:]:
    n='pczt' if c.startswith('pczt-') else c.rsplit('-',1)[0]
    patched.add((n,c[len(n)+1:]))
print("\n".join(sorted(f"{k[0]} {k[1]}" for k in set(a)|set(b) if k not in patched and a.get(k)!=b.get(k))))
