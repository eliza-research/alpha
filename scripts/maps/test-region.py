#!/usr/bin/env python3
"""Actual local OSM/GraphHopper integration, not provider response fixtures."""
from dataset_manifest import verify
import urllib.request,urllib.error,json,pathlib,os,sqlite3
base='http://127.0.0.1:47850'
def get(path):
 with urllib.request.urlopen(base+path,timeout=20) as r:return json.load(r)
meta=get('/capabilities');assert meta['providerId']=='alpha-osm-monaco'
places=get('/search?q=Casino');assert places and all(p['providerId']==meta['providerId'] for p in places)
assert get('/place?id='+places[0]['id'])['id']==places[0]['id']
assert get('/search?q=AlphaPhoneNoSuchPlace_918723')==[]
assert get('/place?id=n0') is None
routes=[]
for mode in ['drive','walk','bicycle']:
 route=get('/route?from=43.7384,7.4246&to=43.7390,7.4272&mode='+mode)
 assert route['mode']==mode and route['distanceMeters']>0 and route['durationSeconds']>0
 assert len(route['geometry'])>2 and route['steps'] and all(s['instruction'] for s in route['steps'])
 assert route['from']=={'latitude':43.7384,'longitude':7.4246} and route['to']=={'latitude':43.739,'longitude':7.4272}
 routes.append({'mode':mode,'distanceMeters':route['distanceMeters'],'durationSeconds':route['durationSeconds'],'geometryPoints':len(route['geometry']),'steps':len(route['steps'])})
for path in ['/route?from=37,-122&to=43.739,7.4272&mode=drive','/route?from=43.7384,7.4246&to=43.739,7.4272&mode=transit']:
 try:get(path);raise AssertionError('Unsupported request unexpectedly succeeded')
 except urllib.error.HTTPError as error:assert error.code==422
root=pathlib.Path(os.environ.get('ALPHA_MAPS_DATA',str(pathlib.Path.home()/'.local/share/alphaphone-maps/monaco')))
with sqlite3.connect(root/'monaco.mbtiles') as db:
 z,x,y,blob=db.execute('select zoom_level,tile_column,tile_row,tile_data from tiles order by zoom_level desc limit 1').fetchone()
 with urllib.request.urlopen(f'{base}/tiles/{z}/{x}/{2**z-1-y}.pbf',timeout=10) as response:assert response.read()==blob
assert meta['revision']==verify(root)[0], 'Gateway revision must match actual runtime dataset'
result={'passed':True,'scope':'Real local regional OSM tiles/search/GraphHopper HTTP; no Android/GPS/global acceptance','provider':meta['providerId'],'revision':meta['revision'],'routes':routes,'tileBytes':len(blob),'sourceManifest':json.loads((root/'source-manifest.json').read_text())}
out=pathlib.Path('test-results/maps-regional-development');out.mkdir(parents=True,exist_ok=True);(out/'backend.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':True,'routes':routes,'tileBytes':len(blob)}))
