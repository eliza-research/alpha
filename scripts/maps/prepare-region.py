#!/usr/bin/env python3
"""Build a bounded real OSM Monaco region; never calls public search/route APIs."""
import pathlib,urllib.request,hashlib,json,subprocess,os,sqlite3,contextlib
# Every fetched byte is pinned; a tool or extract change needs a reviewed sha256/size change here.
assets={
 'monaco.osm.pbf':('https://download.geofabrik.de/europe/monaco-261011.osm.pbf','5ba0c7e6bc8e61dc8f278a0cb97d1510124804f84d9dce8a1e492da7be41b5d2',691631),
 'planetiler.jar':('https://github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar','f310bd0413e2e4512b27f4046d418664e8e1d3bf31603c2a70e23de06c167e4d',93278824),
 'graphhopper.jar':('https://repo.maven.apache.org/maven2/com/graphhopper/graphhopper-web/10.2/graphhopper-web-10.2.jar','ead763749c395ea0cc45b3fd10092d6de84d62fb5cbaf7d416ba6cc142c5716c',46321936),
 'water.zip':('https://raw.githubusercontent.com/onthegomap/planetiler/v0.10.2/planetiler-core/src/test/resources/water-polygons-split-3857.zip','a5a703fc72209e0f9b73a121bf31b3e5945794b244749ff87d99d91264d94b2b',767047),
 'earth.zip':('https://raw.githubusercontent.com/onthegomap/planetiler/v0.10.2/planetiler-core/src/test/resources/natural_earth_vector.sqlite.zip','8264d95831af19e033b22e18750277559bb90f99144d2dd0e5f182acca59fb4e',6502067),
 # Planetiler's OpenMapTiles profile reads this default path; fetching it here replaces --download.
 'data/sources/lake_centerline.shp.zip':('https://github.com/acalcutt/osm-lakelines/releases/download/v12/lake_centerline.shp.zip','6c900507c88fc9f5b5a386f90fd0a42d0495e8755a03d075538fb9a6801a3192',80906805),
}
def digest(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  while chunk:=f.read(1024*1024):h.update(chunk)
 return h.hexdigest()
def check(p,name,sha256,size):
 if p.stat().st_size!=size or digest(p)!=sha256:raise RuntimeError(f'{name} does not match its pinned sha256/size. Remove {p} and rerun.')
def fetch(root,name,url,sha256,size):
 p=root/name;partial=pathlib.Path(str(p)+'.partial')
 if p.exists():return check(p,name,sha256,size)
 p.parent.mkdir(parents=True,exist_ok=True)
 request=urllib.request.Request(url,headers={'User-Agent':'AlphaPhone-RegionalMaps/0.1 (+https://github.com/alphacompute/alphaphone)'})
 try:
  with urllib.request.urlopen(request,timeout=60) as response, open(partial,'wb') as out:
   total=0
   while chunk:=response.read(1024*1024):
    total+=len(chunk)
    if total>size:raise RuntimeError(f'{name} is larger than its pinned size')
    out.write(chunk)
  check(partial,name,sha256,size)
 except BaseException:
  partial.unlink(missing_ok=True);raise
 partial.replace(p)
def tiles(root,run=subprocess.run):
 out=root/'monaco.mbtiles'
 if out.exists():return
 # The .mbtiles extension keeps Planetiler's output format; only a zero exit is renamed into place.
 partial=root/'monaco.partial.mbtiles'
 partial.unlink(missing_ok=True)
 try:
  run(['java','-Xmx1g','-jar',str(root/'planetiler.jar'),'--osm-path='+str(root/'monaco.osm.pbf'),'--water-polygons-path='+str(root/'water.zip'),'--natural-earth-path='+str(root/'earth.zip'),'--output='+str(partial),'--bounds=7.409,43.724,7.449,43.752','--threads=2'],cwd=root,check=True,timeout=600)
  with contextlib.closing(sqlite3.connect(f'file:{partial}?mode=ro',uri=True)) as db:
   if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or not db.execute('SELECT count(*) FROM tiles').fetchone()[0]:raise RuntimeError('Planetiler output failed its integrity check')
 except BaseException:
  partial.unlink(missing_ok=True);raise
 partial.replace(out)
def main():
 root=pathlib.Path(os.environ.get('ALPHA_MAPS_DATA',str(pathlib.Path.home()/'.local/share/alphaphone-maps/monaco'))).resolve()
 root.mkdir(parents=True,exist_ok=True,mode=0o700)
 manifest={}
 for name,(url,sha256,size) in assets.items():
  fetch(root,name,url,sha256,size)
  manifest[name]={'url':url,'sha256':sha256,'bytes':size}
  print(name,size,flush=True)
 (root/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 tiles(root)
 for name in ['monaco.mbtiles','places.sqlite']:
  p=root/name
  if p.exists():manifest[name]={'sha256':digest(p),'bytes':p.stat().st_size}
 (root/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print('Prepared',root)
if __name__=='__main__':main()
