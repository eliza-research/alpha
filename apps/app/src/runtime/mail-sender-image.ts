/** Public website icons from Google, cached by the browser. Only the domain is requested. */
export function mailSenderImage(email:string|null|undefined,enabled:boolean):string|null{
 if(!enabled||!email||email.length>320)return null;
 const match=/^[^\s<>@]+@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.exec(email);
 if(!match)return null;
 const domain=match[1].toLowerCase();
 // Delivery-only subdomains commonly have no website icon. Keep the sender's domain hierarchy.
 const website=domain.replace(/^(?:mail|email)\./,'');
 // Shared personal-mail providers do not identify an individual sender.
 if(/(?:^|\.)(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.com|icloud\.com|proton\.me|protonmail\.com|aol\.com)$/.test(website))return null;
 if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)||/\.(?:local|localhost|internal|invalid|test|example|onion)$/.test(domain))return null;
 const source=new URL('https://www.google.com/s2/favicons');
 source.searchParams.set('domain',website);
 source.searchParams.set('sz','128');
 return source.href;
}
