"""Inert contract tests. No downloads, builds, model calls, or qualification claims."""
import copy
import io
import urllib.error
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('embedding_artifacts', ROOT / 'scripts/ci/embedding-artifacts.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EmbeddingInputsTest(unittest.TestCase):
    def test_artifact_metadata_is_pinned_and_same_repository(self):
        value={'id':11,'expired':False,'digest':'sha256:'+'a'*64,'size_in_bytes':50,
               'workflow_run':{'id':13,'repository_id':module.REPOSITORY_ID,'head_repository_id':module.REPOSITORY_ID,'head_sha':'c'*40}}
        self.assertEqual(module.validate_metadata(value,'11','a'*64)['id'],13)
        for changed in [{'expired':True},{'digest':'sha256:'+'b'*64},{'size_in_bytes':module.MAX_ARCHIVE+1},
                        {'workflow_run':{**value['workflow_run'],'head_repository_id':0}}]:
            with self.subTest(changed=changed),self.assertRaises(ValueError):module.validate_metadata({**value,**changed},'11','a'*64)

    def test_repository_admission_follows_the_same_id_across_owner_transfer(self):
        for name in ('eliza-research/alpha', 'alphacompute/alpha'):
            with self.subTest(name=name):
                env = {'GITHUB_REPOSITORY': name, 'GITHUB_REPOSITORY_ID': str(module.REPOSITORY_ID)}
                self.assertTrue(module.canonical_repository(env))
                self.assertFalse(module.canonical_repository({**env, 'GITHUB_REPOSITORY_ID': '1'}))
        self.assertFalse(module.canonical_repository({}))

    def test_redirects_never_accept_local_or_non_tls_hosts(self):
        module.safe_redirect('https://release.blob.core.windows.net/valid?signature=opaque')
        for url in ['http://github.com/x','https://localhost/x','https://127.0.0.1/x','https://evil.test/x','https://user:pass@github.com/x']:
            with self.subTest(url=url),self.assertRaises(ValueError):module.safe_redirect(url)

    def test_download_strips_credentials_after_api_redirect(self):
        data=b'bounded artifact';digest=hashlib.sha256(data).hexdigest();requests=[]
        meta={'id':11,'expired':False,'digest':'sha256:'+digest,'size_in_bytes':len(data),
              'workflow_run':{'id':13,'repository_id':module.REPOSITORY_ID,'head_repository_id':module.REPOSITORY_ID,'head_sha':'c'*40}}
        class Opener:
            def open(self,request,timeout):
                requests.append(request)
                if request.full_url.endswith('/artifacts/11'):return io.BytesIO(json.dumps(meta).encode())
                if request.full_url.endswith('/runs/13'):return io.BytesIO(json.dumps({'conclusion':'success','head_sha':'c'*40}).encode())
                if request.full_url.endswith('/zip'):raise urllib.error.HTTPError(request.full_url,302,'redirect',{'Location':'https://approved.blob.core.windows.net/artifact'},None)
                return io.BytesIO(data)
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'artifact.zip';module.download('11',digest,target,'synthetic-token',Opener())
            self.assertEqual(target.read_bytes(),data)
        api = f'https://api.github.com/repositories/{module.REPOSITORY_ID}/'
        self.assertEqual([request.full_url for request in requests[:3]], [
            api + 'actions/artifacts/11', api + 'actions/runs/13', api + 'actions/artifacts/11/zip',
        ])
        self.assertIsNotNone(requests[2].get_header('Authorization'))
        self.assertIsNone(requests[3].get_header('Authorization'))

    def test_download_mismatched_bytes_fail(self):
        digest=hashlib.sha256(b'expected').hexdigest()
        meta={'id':11,'expired':False,'digest':'sha256:'+digest,'size_in_bytes':8,
              'workflow_run':{'id':13,'repository_id':module.REPOSITORY_ID,'head_repository_id':module.REPOSITORY_ID,'head_sha':'c'*40}}
        class Opener:
            def open(self,request,timeout):
                if request.full_url.endswith('/artifacts/11'):return io.BytesIO(json.dumps(meta).encode())
                if request.full_url.endswith('/runs/13'):return io.BytesIO(json.dumps({'conclusion':'success','head_sha':'c'*40}).encode())
                return io.BytesIO(b'tampered')
        with tempfile.TemporaryDirectory() as tmp,self.assertRaises(ValueError):module.download('11',digest,Path(tmp)/'artifact.zip','synthetic-token',Opener())

    def test_zip_rejects_traversal_duplicate_and_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for i,names in enumerate([['../escape'],['same','same'],['symlink']]):
                archive=root/str(i)
                with zipfile.ZipFile(archive,'w') as z:
                    for name in names:
                        info=zipfile.ZipInfo(name)
                        if name=='symlink':info.external_attr=(stat.S_IFLNK|0o777)<<16
                        z.writestr(info,b'data')
                with self.assertRaises(ValueError):module.extract_selected(archive,root/('out'+str(i)),{})

    def test_zip_extracts_only_exact_requested_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);archive=root/'input.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('required.json',b'{}');z.writestr('unused.txt',b'unused')
            module.extract_selected(archive,root/'out',{'required.json':'receipt.json'})
            self.assertEqual((root/'out/receipt.json').read_bytes(),b'{}');self.assertFalse((root/'out/unused.txt').exists())

    def fixture(self,root):
        semantic={'pass':True,'nativeAbi':'21','dimensions':384,'embeddingCalls':10,'callerRetirementDrained':True,
                  'nativeKernelCancellationClaimed':False,'rawNorms':[1.0]*10,'repeatCosine':1.0,'reopenCosine':1.0,
                  'relatedCosine':.8,'unrelatedCosine':.2,'elapsedMs':100}
        raw=json.dumps(semantic).encode()
        inventory=json.loads((ROOT / 'android/embedding-host/qualified-host.json').read_text())
        component={'pin':'a'*40,'forkPin':'b'*40,'identity':'ai.alphacompute.alphaphone','abi':'arm64-v8a','built':True,
                   'inputs':[{'path':row['path'],'sourceSha256':'a'*64,'generatedSha256':'b'*64} for row in inventory['inputs']],
                   'producerInputs':[{'path':row['path'],'sha256':'c'*64} for row in inventory['producerInputs']],
                   'jniBinding':{'mode':'registered'},'libraries':[]}
        for name in module.LIBRARIES:
            data=name.encode();(root/name).write_bytes(data)
            component['libraries'].append({'path':'/original/build/'+name,'sha256':hashlib.sha256(data).hexdigest(),
                                          'bytes':len(data),'alignment16KiB':True})
        qualification={**copy.deepcopy(component),'qualifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'semanticReceiptSha256':hashlib.sha256(raw).hexdigest()}
        intent={'SDK':component['pin'],'native':component['forkPin'],'source':'c'*40,'compileOnly':True}
        return component,intent,qualification,semantic,raw

    def test_valid_receipts_preserve_original_compiled_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);args=self.fixture(root);original=copy.deepcopy(args[2])
            self.assertEqual(len(args[0]['producerInputs']), 14)
            result=module.validate_receipts(*args,root)
            self.assertEqual(result['compiledSDK'],'a'*40);self.assertFalse(result['qualificationTransferred'])
            self.assertEqual(args[2],original,'validation must not relabel or rewrite the receipt')

    def test_incomplete_or_changed_compiled_input_inventories_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for key,digest in [('inputs','generatedSha256'),('producerInputs','sha256')]:
                mutations={
                    'missing':lambda rows:rows.pop(),
                    'duplicate':lambda rows:rows.__setitem__(0,copy.deepcopy(rows[1])),
                    'unexpected':lambda rows:rows[0].update(path='unreviewed/input.ts'),
                    'malformed digest':lambda rows:rows[0].update({digest:'not-a-digest'}),
                }
                for name,mutate in mutations.items():
                    with self.subTest(inventory=key,mutation=name):
                        args=self.fixture(root);mutate(args[0][key]);args[2][key]=copy.deepcopy(args[0][key])
                        with self.assertRaisesRegex(ValueError,'Complete producer/native inputs required'):
                            module.validate_receipts(*args,root)

    def test_compile_only_or_relabelled_receipts_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for mutation in [lambda q:q.pop('qualifiedAt'),lambda q:q.update(pin='d'*40),
                             lambda q:q.update(producerInputs=[]),lambda q:q['producerInputs'][0].update(sha256='d'*64),
                             lambda q:q.update(semanticReceiptSha256='0'*64)]:
                args=self.fixture(root);mutation(args[2])
                with self.assertRaises(ValueError):module.validate_receipts(*args,root)

    def test_failed_incomplete_or_nonfinite_semantics_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for changed in [{'pass':False},{'nativeAbi':'19'},{'dimensions':768},{'embeddingCalls':9},
                            {'rawNorms':[0.0]*10},{'relatedCosine':float('nan')},{'callerRetirementDrained':False},
                            {'elapsedMs':{'private':'blocked'}},{'elapsedMs':'private text'},{'elapsedMs':float('nan')},
                            {'elapsedMs':float('inf')},{'elapsedMs':-1},{'elapsedMs':True}]:
                args=list(self.fixture(root));args[3].update(changed);args[4]=json.dumps(args[3]).encode()
                args[2]['semanticReceiptSha256']=hashlib.sha256(args[4]).hexdigest()
                with self.subTest(changed=changed),self.assertRaises(ValueError):module.validate_receipts(*args,root)

    def test_carrier_only_accepts_reviewed_data_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.fixture(Path(tmp));module.validate_carrier_schema(args[2],args[3])
            for value,key in [(args[2],'accountHistory'),(args[3],'privateText')]:
                value[key]='must not be uploaded'
                with self.assertRaises(ValueError):module.validate_carrier_schema(args[2],args[3])
                del value[key]

    def test_carrier_requires_immutable_commit_and_both_file_hashes(self):
        env={'ALPHA_EMBEDDING_CARRIER_COMMIT':'d'*40,'ALPHA_EMBEDDING_COMPONENT_ARTIFACT_ID':'11',
             'ALPHA_EMBEDDING_COMPONENT_SHA256':'a'*64,'ALPHA_EMBEDDING_QUALIFICATION_FILE_SHA256':'b'*64,
             'ALPHA_EMBEDDING_SEMANTIC_FILE_SHA256':'c'*64}
        self.assertEqual(module.carrier_settings(env),('11','a'*64))
        for key in env:
            changed=dict(env);changed.pop(key)
            with self.assertRaises(ValueError):module.carrier_settings(changed)

    def test_carrier_files_are_hash_bound_and_cannot_be_symlinks(self):
        import os
        previous=Path.cwd()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp);root=Path('qualification-carrier/embedding-qualification');root.mkdir(parents=True)
                data=b'{}';(root/'QUALIFICATION.json').write_bytes(data);digest=hashlib.sha256(data).hexdigest()
                self.assertEqual(module.read_carrier_bytes(root,'QUALIFICATION.json',digest),data)
                with self.assertRaises(ValueError):module.read_carrier_bytes(root,'QUALIFICATION.json','0'*64)
                (root/'link.json').symlink_to('QUALIFICATION.json')
                with self.assertRaises(ValueError):module.read_carrier_bytes(root,'link.json',digest)
            finally:os.chdir(previous)

    def test_qualification_cannot_change_symbols_or_artifact_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for changed in [{'requiredSymbols':['unexpected']},{'artifactPath':'../private'}]:
                args=self.fixture(root);args[2]['libraries'][0].update(changed)
                with self.assertRaises(ValueError):module.validate_receipts(*args,root)

    def test_registered_carrier_json_is_exact_and_bounded(self):
        value={'commit':'d'*40,'qualification_sha256':'b'*64,'semantic_sha256':'c'*64}
        env={'ALPHA_EMBEDDING_CARRIER_JSON':json.dumps(value),'ALPHA_EMBEDDING_COMPONENT_ARTIFACT_ID':'11','ALPHA_EMBEDDING_COMPONENT_SHA256':'a'*64}
        expanded=module.carrier_environment(env)
        self.assertEqual(module.carrier_settings(expanded),('11','a'*64))
        self.assertEqual(expanded['ALPHA_EMBEDDING_CARRIER_COMMIT'],value['commit'])
        for raw in ['not json',json.dumps({**value,'command':'unapproved'}),json.dumps({**value,'commit':{}}),'x'*513]:
            with self.assertRaises(ValueError):module.carrier_environment({**env,'ALPHA_EMBEDDING_CARRIER_JSON':raw})

    def test_component_bytes_must_match_qualification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);args=self.fixture(root);(root/module.LIBRARIES[0]).write_bytes(b'changed')
            with self.assertRaises(ValueError):module.validate_receipts(*args,root)


if __name__=='__main__':unittest.main()
