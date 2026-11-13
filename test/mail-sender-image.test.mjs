import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mailSenderImage} from '../apps/app/src/runtime/mail-sender-image.ts';
test('website icons request the exact domain from Google without sending the address',()=>{
 for(const domain of ['linkedin.com','read.ai','typesafe.ai','eliza.app','news.example.org']) {
  const url=new URL(mailSenderImage('notice@'+domain,true));
  assert.equal(url.origin,'https://www.google.com');
  assert.equal(url.searchParams.get('domain'),domain);
  assert.equal(url.searchParams.get('sz'),'128');
  assert.equal(url.href.includes('notice'),false);
 }
 assert.equal(new URL(mailSenderImage('a@service.paypal.com',true)).searchParams.get('domain'),'service.paypal.com');
 assert.equal(new URL(mailSenderImage('a@paypal.com.attacker.org',true)).searchParams.get('domain'),'paypal.com.attacker.org');

});
test('disabled remote images and personal senders keep initials',()=>{
 for(const email of ['a@gmail.com','a@outlook.com','a@proton.me'])assert.equal(mailSenderImage(email,true),null);
 assert.equal(mailSenderImage('notice@linkedin.com',false),null);
});
test('untrusted addresses cannot inject a URL or target literal local addresses',()=>{
 for(const email of [null,'a@localhost','a@127.0.0.1','a@[::1]','a@internal.local','a@foo.invalid','a@foo.com:123','a@foo.com/x','a@foo.com?x','a@user@foo.com','a@-foo.com','a@foo..com','a@foo.com\n'])assert.equal(mailSenderImage(email,true),null,email);
});

test('mail delivery subdomains use the website icon',()=>{
 for(const [email,website] of [['notice@mail.instagram.com','instagram.com'],['notice@email.nianticlabs.com','nianticlabs.com']]){
  assert.equal(new URL(mailSenderImage(email,true)).searchParams.get('domain'),website);
 }
 assert.equal(mailSenderImage('notice@mail.gmail.com',true),null);
});
