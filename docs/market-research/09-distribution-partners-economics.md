# 09 — Distribution, partners and unit economics

Product baseline, from [android-and-aosp.md](../android-and-aosp.md), [native-app-distribution.md](../native-app-distribution.md) and [enclave-candidate-validation.md](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md). Alpha Phone today is:

- an Android app in two flavors, standalone and HOME launcher (`ai.alphacompute.alphaphone`);
- a generated, non-privileged AOSP vendor add-on that has not been booted as a full signed image on a physical Pixel;
- a cloud agent in AWS Nitro Enclaves that calls Cerebras `qwen-3.8-27b` for inference. The latest candidate is not deployed.

On-device STT/TTS is required for the MVP but not yet built. Alpha forks AOSP for its own image and does **not** need banking apps, Google Play Integrity or GMS; MDM support for AOSP devices remains a real constraint. Cloud inference stays on Qwen (`qwen-3.8-27b` on Cerebras).

**Conventions.** Every number has a URL. **(est.)** marks an analyst estimate, with the basis stated; **(unverified)** marks a figure not confirmed against a primary source. Some figures come from [03-secure-phones-confidential-ai.md](03-secure-phones-confidential-ai.md), cited with that file's original URLs ("via 03"). Pixel 10 teardowns from TechInsights are paywalled ([Pixel 10](https://www.techinsights.com/blog/summary-google-pixel-10-glbw0-deep-dive-teardown), [Pixel 10 Pro](https://www.techinsights.com/blog/inside-google-pixel-10-pro-most-comprehensive-teardown-available)) and no public Counterpoint BOM exists, so BOM figures are estimates bounded by Google's official repair-part prices.

---

## Executive summary

1. **Start with software, not hardware.** A Pixel 10 costs $799–$1,199 ([Google](https://blog.google/products/pixel/google-pixel-10-pro-xl/)) and is already FCC-, PTCRB- and carrier-certified, with 7 years of updates. The Pixel 11 launched on 2026-08-12 (shipping 2026-08-20) from **$899** with 256 GB base storage, Tensor G6, 12 GB RAM and 7 years of updates ([Engadget](https://www.engadget.com/2234844/google-pixel-11-announced-specs-availability/)). Pro and Pro XL prices of $1,099 and $1,299 were reported by secondary sources (unverified). Alpha can ride that for $0 in certification. A custom ODM phone adds NRE, MOQ and certification costs of **$1.5–6M (est.)** before the first unit ships.
2. **The custom AOSP image carries a channel cost as well as an engineering cost, but not the one usually assumed.**
   - An image signed with Alpha's keys fails Play Integrity device and strong integrity ([GrapheneOS](https://grapheneos.org/articles/attestation-compatibility-guide)), shows a boot warning ([AOSP](https://source.android.com/docs/security/features/verifiedboot/device-state)) and cannot carry GMS. **Alpha's own AOSP image does not need banking apps, Google Wallet, Play Integrity or GMS, so these are not blockers for the custom image.** Partner apps can verify Alpha devices with hardware key attestation instead.
   - **What remains a real constraint is MDM.** Intune's AOSP management covers only an allow-list of OEM devices. As of the page's 2026 revision, the only phone on that list is still the HMD Terra M; the rest are headsets plus the Zebra WS50 ([Microsoft Learn](https://learn.microsoft.com/en-us/mem/intune/fundamentals/android-os-project-supported-devices)).
   - Android Enterprise, zero-touch and managed Google Play are the main enterprise MDM channels, and they assume a GMS device. A custom-image fleet therefore needs either an MDM vendor that will allow-list Alpha's build or Alpha's own device-management path. The stock-Pixel app/launcher remains the fastest route into fleets already run on Intune or Workspace ONE.
3. **Inference, not hardware, sets the margin.** At Cerebras' listed $0.99/M input and $1.49/M output for Qwen3.8 27B ([Cerebras docs](https://inference-docs.cerebras.ai/models/qwen-3.8-27b), [pricepertoken](https://pricepertoken.com/endpoints/cerebras)), a typical agent user costs **~$13/month in tokens (est.)**, and a heavy user **~$40 (est.)**. Shared Nitro compute adds **~$3–6 (est.)**. Nitro Enclaves carry no surcharge ([AWS](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/)). A **dedicated enclave per owner costs at least $97–147/month** in instance fees alone (est., from [Vantage m7i.xlarge](https://instances.vantage.sh/aws/ec2/m7i.xlarge)). That tier works only for executives and sovereign customers.
4. **Pricing anchors are wide.**
   - Otter Business: $19.99/user/month billed annually ([Otter](https://otter.ai/pricing)).
   - Plaud: $159 device plus $99.99–$239.99/year ([Plaud](https://www.plaud.ai/products/plaud-note-ai-voice-recorder); [Sacra](https://sacra.com/c/plaud/)).
   - Jump: $80–100/advisor/month plus add-ons ([Jump](https://jump.ai/pricing)).
   - Abridge: ~$2,500/clinician/year ([Sacra](https://sacra.com/c/abridge/)).
   - Bittium Tough Mobile 2C: $4,499.99 from one reseller ([welectronics via 03](https://welectronics.com/shop/gsm-phones/bittium-tough-mobile-2c-64gb-4gb-ram-gsm-unlocked-phone-qualcomm-snapdragon-670-detail)).
   - A general "AI notes" seat cannot carry Alpha's inference costs. A **vertical agent at $79–149/user/month** can.
5. **Finance is the fastest channel.** It has a regulator-created budget: $392.75M in SEC off-channel fines across 26 firms in one August 2024 action ([SEC](https://www.sec.gov/newsroom/press-releases/2024-98)), and about **$2B across 100+ firms** over the Dec 2021–Oct 2024 sweep ([FINRA](https://www.finra.org/media-center/blog/sec-off-channel-communications-settlements-sro-collateral-consequences)). **2025–26 caveat:** SEC Chair Paul Atkins has said recordkeeping cases consumed resources "not commensurate with any measure of investor harm", and January 2025 settlements carried lighter terms. The SEC still refused (2025-04-14) to soften earlier settlements, and the recordkeeping rules are unchanged, but the *new-fine* driver is weakening ([Bond Buyer](https://www.bondbuyer.com/news/secs-atkins-criticizes-off-channel-comms-enforcement), [Harvard CorpGov](https://corpgov.law.harvard.edu/2026/01/21/sec-enforcement-2025-year-in-review/)). Sell on compliance hygiene and archive integration, not fear of fines. It also has ready partners: Theta Lake (100+ integrations, including Verizon, AT&T and AI tools, per [Theta Lake](https://thetalake.com/integrations/)), Smarsh (sold on AWS Marketplace, per [Smarsh](https://www.smarsh.com/partners/)) and LeapXpert, whose archive partners are Smarsh, Global Relay and Theta Lake ([LeapXpert](https://www.leapxpert.com/partners/)).
6. **The fastest government channel is Carahsoft plus an OTA, not GSA MAS first.** DIU awards prototype OTAs "in as few as 60–90 days" ([DIU](https://www.diu.mil/work-with-us)). Carahsoft supports 3,000+ resellers and integrators ([Wikipedia](https://en.wikipedia.org/wiki/Carahsoft)) and invested in Hypori ([Hypori PR via 03](https://www.hypori.com/news-and-media/hypori-secures-strategic-series-b-extension-funding)). The Army is moving users from government-furnished phones to BYOD plus Hypori ([DVIDS via 03](https://www.dvidshub.net/news/564961/army-sets-deadline-dmuc-device-turn-in-moves-new-mobility-program)), which undercuts a "second secure phone" pitch to DoD.

---

## 1. Channels

### 1.1 US carriers and their enterprise and government arms

| Carrier program | What it is | Scale and facts | Relevance to Alpha | Source |
| --- | --- | --- | --- | --- |
| **AT&T FirstNet** | Public-safety network on Band 14 (20 MHz at 700 MHz) with priority and preemption. Congress funded it in 2012; the AT&T award was March 2017; the initial build finished 30 March 2023 | **$7B** federal funding. Serves law enforcement, fire, EMS, 911 centers, healthcare, utilities and school safety | Devices sold into FirstNet go through **FirstNet Ready/Certified** device programs (requirements and fees not public; unverified). A stock Pixel app needs no certification. A custom image would need device certification | [Wikipedia](https://en.wikipedia.org/wiki/FirstNet); [firstnet.com](https://www.firstnet.com/); [firstnet.gov](https://www.firstnet.gov/network) |
| **Verizon Frontline** | Priority and preemption, a 5G **Frontline Network Slice** with "guaranteed, dedicated bandwidth", Push-to-Talk Plus, and a crisis response team | "Over **45,000** agencies" | Carries rugged devices (for example, Sonim). A route to public-safety agencies for an *app* through Verizon's app and solution marketplace (est.) | [Verizon](https://www.verizon.com/business/solutions/public-sector/public-safety/) |
| **T-Mobile T-Priority / T-Mobile for Government** | 5G standalone network slice for first responders | Launch 2025; pricing not public (unverified) | Same pattern as Verizon | [T-Mobile](https://www.t-mobile.com/business/government/public-safety/t-priority) |
| **Carrier business channels** (all three) | Sell Pixels, Samsung and rugged devices bundled with lines. They resell EMM and zero-touch | — | A **device-as-a-service bundle** can use a carrier as the Pixel logistics and zero-touch reseller, with Alpha provisioned by EMM. The phone needs no certification of its own | [Android zero-touch](https://www.android.com/enterprise/management/zero-touch/) |

**Carrier and device certification**

| Step | Applies to | Cost | Time | Source |
| --- | --- | --- | --- | --- |
| FCC equipment authorization through a TCB (Part 15/22/24/27, SAR) | Any new radio device | **$15k–$60k** lab and TCB fees per SKU (est.) | 4–8 weeks (est.) | [FCC EA overview](https://www.fcc.gov/engineering-technology/laboratory-division/general/equipment-authorization) |
| **PTCRB** (CTIA-administered; NA operators may block uncertified devices) | Cellular devices on AT&T and T-Mobile; also used by others | Certification fee **$1,500–$15,000**. Lab testing is priced separately by each lab: **$50k–$250k (est.)** for a new phone design | Depends on how much related-device evidence can be reused; 6–12 weeks (est.) | [PTCRB](https://www.ptcrb.com/); [Wikipedia](https://en.wikipedia.org/wiki/PTCRB) |
| Operator acceptance (Verizon ODI, AT&T, T-Mobile technical acceptance; IMS/VoLTE, WEA, 911) | Any device sold or supported by the carrier | **$100k–$500k** per carrier including engineering (est.) | 3–6 months per carrier (est.) | Inference; no public fee schedule found |
| FirstNet Ready / Certified | Band 14 public-safety devices | Not public (unverified) | — | [firstnet.com](https://www.firstnet.com/) |
| Stock Pixel 10 running Alpha as an app or launcher | — | **$0** incremental: Google already certified the hardware and OS | 0 | [Google](https://blog.google/products/pixel/google-pixel-10-pro-xl/) |
| Pixel running Alpha's **custom AOSP image** | — | Radio firmware and IMEI stay Google's, but the software build differs. Carriers treat custom ROMs as unsupported. VoLTE, VoWiFi and emergency-call provisioning must be re-tested (est.) | — | Inference from [android-and-aosp.md](../android-and-aosp.md) |

### 1.2 MDM/EMM and Android Enterprise

| Vendor | Android price | Custom-AOSP support | Notes | Source |
| --- | --- | --- | --- | --- |
| **Microsoft Intune** | Plan 1 **$8/user/month** (included in M365 E3 at $39 and E5 at $60). Plan 2 add-on $4. Intune Suite $10. From July 2026 some advanced capabilities move into E3/E5 | **AOSP management is limited to allow-listed OEM devices** (AR/VR headsets, Zebra WS50). The only listed phone is still the **HMD Terra M** | Largest installed base in regulated enterprises. On stock Pixels, Alpha ships as a **managed Google Play app** with managed configuration. Alpha's AOSP image would need Microsoft to allow-list it; this is the main remaining channel cost of the fork | [Intune pricing](https://www.microsoft.com/en-us/security/business/microsoft-intune-pricing); [Intune AOSP devices](https://learn.microsoft.com/en-us/mem/intune/fundamentals/android-os-project-supported-devices) |
| **Omnissa Workspace ONE UEM** | Mobile Essentials **$3.00/device** or $5.40/user; UEM Essentials $5.25; Enterprise $10; Platinum $15.63/device/month | Supports "closed network"/AOSP enrollment for specific OEMs (unverified) | Strong with federal and healthcare customers | [Omnissa](https://www.omnissa.com/products/workspace-one-unified-endpoint-management/) |
| **Jamf** | Apple-focused. **Not an Android channel** | — | Taken private by Francisco Partners for **$2.2B**, closed 30 Jan 2026. 2024 revenue $627.4M | [Wikipedia](https://en.wikipedia.org/wiki/Jamf) |
| **Samsung Knox Suite** | Price not public. Typically a few dollars per device per month (est.) | Samsung devices only | Knox is on the NSA CSfC component list ([FedScoop via 03](https://fedscoop.com/samsung-knox-nsa/)). The main hardened-Android competitor, and a porting target (see §2) | [Knox](https://www.samsungknox.com/en/knox-suite) |
| **Google Android Enterprise** | Free to use. Zero-touch works on "all Android 9.0+ devices" and "may be subject to reseller fees in certain countries" | Zero-touch and managed Play need GMS devices (est.) | The partner directory has **Silver** and **Gold** tiers. Silver is a base level of business, product and performance requirements; Gold doubles the certifications and requires year-over-year growth | [Zero-touch](https://www.android.com/enterprise/management/zero-touch/); [Partner directory](https://androidenterprisepartners.withgoogle.com/) |

**Android Enterprise Recommended (AER) for devices.** This applies to Alpha only if it ships its own device ([requirements](https://www.android.com/enterprise/recommended/requirements/)):

- Android 16: **6 GB RAM**, 32 GB storage and 64-bit.
- The OEM must publish its security-patch frequency and support **+1 OS version**; +7 is recommended.
- The device must support ESMR (Emergency Security Maintenance Release).
- The device must support **zero-touch and QR bulk enrollment**.

Pixel already meets these. A custom ODM device would need Google validation. That in turn assumes GMS, which requires a MADA/GMS licence, CTS/GTS passes and a Google-approved (3PL) test lab (est.).

**What this means for launcher deployment.** Android Enterprise "fully managed" mode lets the EMM set a persistent preferred HOME activity. Alpha's HOME flavor can then be deployed as a managed app without an OS image, which matches the "explicit device provisioning" requirement in [android-and-aosp.md](../android-and-aosp.md) (est.). **This is the most important distribution fact in this report:** the launcher can reach enterprise fleets through Intune or Workspace ONE on stock Pixels, with no AOSP image.

### 1.3 VARs, distributors and government contract vehicles

| Vehicle or partner | What it is | Economics and scale | Time to access | Source |
| --- | --- | --- | --- | --- |
| **Carahsoft** | Master government aggregator and distributor | Supports **3,000+** resellers and integrators. Holds a 10-year **$2.5B** GSA SaaS BPA (2018). The FBI/DCIS raided it on **24 Sept 2024** in a bid-rigging investigation; reputational risk to monitor | 1–3 months to onboard as a vendor (est.). It carries the vendor on its own GSA, SEWP and state contracts | [Wikipedia](https://en.wikipedia.org/wiki/Carahsoft); [Carahsoft/Hypori](https://www.carahsoft.com/hypori) |
| **Immix Group (Arrow)** | Government distributor, a Carahsoft alternative | n/d | Similar | [immixgroup.com](https://www.immixgroup.com/) |
| **CDW / CDW-G** | Largest US IT VAR | CDW 2025 revenue **$22.4B** (government share not in source) | Vendor onboarding plus a Pixel/zero-touch reseller relationship | [Wikipedia](https://en.wikipedia.org/wiki/CDW) |
| **SHI** | Large private VAR; the largest minority- and woman-owned business enterprise in the US | ~6,000 staff, 17,000 customers. Holds **NASA SEWP V** and **Army ITES-SW2** | As above | [Wikipedia](https://en.wikipedia.org/wiki/SHI_International_Corp.) |
| **GSA MAS** | Federal schedule | IFF is "a percentage of total quarterly sales… set at the discretion of GSA's FAS". **0.75%** for MAS ([VSC IFF rates](https://vsc.gsa.gov/drupal/node/203)). Transactional Data Reporting is reported as mandatory across MAS (unverified). Requires **TAA-compliant** products: China, India and Vietnam are *not* designated countries | Own schedule: 6–12 months (est.). Riding Carahsoft's is faster | [GSAM 552.238-80](https://www.acquisition.gov/gsam/552.238-80); [vsc.gsa.gov](https://vsc.gsa.gov/); [FAR 52.225-5](https://www.acquisition.gov/far/52.225-5) |
| **NASA SEWP** | Government-wide IT products and services vehicle | **0.34%** fee on task orders, built into the holder's price (per secondary guides). **SEWP VI** was awarded in June 2026 to a much larger pool (reported ≈2,100 awards across ≈1,500 vendors); ordering opens **2026-11-01** and runs to 2036-10-31 ([GovEagle](https://www.goveagle.com/blog/nasa-sewp-contract-guide); unverified on a NASA page) | Access through SEWP holders such as SHI; with the larger SEWP VI pool, a direct small-business award may be achievable in a later on-ramp (est.) | [sewp.nasa.gov](https://www.sewp.nasa.gov/) |
| **DoD ESI** | DoD Enterprise Software Initiative BPAs for COTS software | n/d | Needs demand from DoD components first | [esi.mil](https://www.esi.mil/) |
| **OTA / DIU CSO** | 10 USC 4022 prototype OTAs, awarded "in as few as 60–90 days". A **Success Memo** "allows any Federal agency to use the solution without re-competition". Companies generally keep their IP | Prototype sizes are typically $0.5–5M (est.) | 2–6 months | [DIU](https://www.diu.mil/work-with-us) |
| **TD SYNNEX** (international) | Largest IT distributor | **$62.5B** revenue (2025), 100+ countries, ~1,500 vendors | Useful only after product-market fit | [Wikipedia](https://en.wikipedia.org/wiki/TD_Synnex) |

**Supply-chain constraints on hardware sold to the federal government.**

- **FAR 52.204-25 (NDAA §889)** bars Huawei, ZTE, Hytera, Hikvision and Dahua equipment as a "substantial or essential component" ([FAR](https://www.acquisition.gov/far/52.204-25)).
- **TAA** requires the end product to be made or substantially transformed in a designated country ([FAR 52.225-5](https://www.acquisition.gov/far/52.225-5)).
- Wingtech, whose ODM business was a major phone ODM, was put on the **Entity List in December 2024** ([Wikipedia](https://en.wikipedia.org/wiki/Wingtech)).
- For government hardware, therefore, Alpha should use an EU or US ODM, or Pixel/Samsung devices bought through carrier and VAR vehicles that already handle compliance. Chinese ODMs should be avoided.

### 1.4 System integrators

| SI | Scale | Where Alpha fits | Source |
| --- | --- | --- | --- |
| Booz Allen Hamilton | FY2024 revenue **$10.7B**, 34,200 staff, ~98% of revenue from the US government. Paid a **$377M** settlement in 2023 | Defense and intelligence AI prototypes. Alpha as a subcontractor or teammate | [Wikipedia](https://en.wikipedia.org/wiki/Booz_Allen_Hamilton) |
| Leidos | 2025 revenue **$17.2B**, 47,000 staff. Has a health division | VA/DHA clinical-mobile teaming (est.) | [Wikipedia](https://en.wikipedia.org/wiki/Leidos) |
| SAIC | FY2026 revenue **$7.26B** | Army and civilian enterprise IT | [Wikipedia](https://en.wikipedia.org/wiki/Science_Applications_International_Corporation) |
| Peraton (Veritas Capital) | 2023 revenue **$7B**, 18,000+ staff | Intelligence community and space | [Wikipedia](https://en.wikipedia.org/wiki/Peraton) |
| GDIT | ~26,000 staff. Supports CENTCOM and CMS modernization | Secure communications, CENTCOM | [Wikipedia](https://en.wikipedia.org/wiki/General_Dynamics_Information_Technology) |
| Accenture Federal Services | Parent company revenue **$69.67B** (2025); federal unit revenue not in source | Civilian agency modernization | [Wikipedia](https://en.wikipedia.org/wiki/Accenture_Federal_Services) |

SIs rarely resell a startup's product without a program to attach it to. The usual route is: an OTA prototype, then a Success Memo, then the SI adds the product to a production follow-on (est.).

### 1.5 Healthcare channels

| Channel | Facts | Fit | Source |
| --- | --- | --- | --- |
| **Epic** (Showroom: Connection Hub, Toolbox, Workshop) | Largest EHR vendor, **325M+** patient records. Faces antitrust suits from Particle (allowed to proceed Sept 2025), CureIS (May 2025) and the Texas AG (Dec 2025) | Ambient documentation is crowded (Abridge, Microsoft DAX, Epic's own tools). Alpha should not lead with a scribe. A Connection Hub listing is a low-cost credibility step once FHIR write-back exists (est.) | [Wikipedia](https://en.wikipedia.org/wiki/Epic_Systems); [Showroom](https://showroom.epic.com/) |
| **Oracle Health** | n/d | Second EHR ecosystem; VA and DoD footprint through MHS Genesis (unverified) | — |
| **Vizient** GPO | **5,000+** members including **1,360** acute-care hospitals | Contracts favor established vendors. Pursue in year 2+ | [Wikipedia](https://en.wikipedia.org/wiki/Vizient) |
| **Premier** GPO | Taken private by Patient Square for **$2.6B** (Nov 2025). Sold its non-healthcare business to **OMNIA Partners for $800M** (2023) | Same | [Wikipedia](https://en.wikipedia.org/wiki/Premier,_Inc.) |
| Benchmark: **Abridge** | ~**$2,500/clinician/year**. $100M ARR (May 2025). $5.3B valuation (June 2025). Kaiser has 24,600 physicians | Shows what health systems pay per clinician for an AI workflow tied to the EHR | [Sacra](https://sacra.com/c/abridge/) |

### 1.6 Finance channels

| Channel | Facts | Fit | Source |
| --- | --- | --- | --- |
| **Envestnet** | **$6.5T** platform assets, **111,000+** advisors. Taken private for **$4.5B** by Bain, with BlackRock, Fidelity, Franklin and State Street (closed Nov 2024) | Largest RIA tech distribution. Partnership is realistic after 20+ RIA references (est.) | [Wikipedia](https://en.wikipedia.org/wiki/Envestnet) |
| **Custodians** (Schwab, Fidelity) | Integration marketplaces for advisors | Integrations for read-only account context. Not a sales channel at first | — |
| **CRM marketplaces** (Salesforce FSC AppExchange, Redtail, Wealthbox) | AppExchange ISV revenue share is commonly **15%** (unverified) | Jump syncs to CRMs; Alpha must too | [Jump](https://jump.ai/pricing) |
| **Compliance archivers** (Smarsh, Global Relay, Theta Lake, LeapXpert) | Smarsh has technology, referral, consulting and **reseller** partner types and sells on **AWS Marketplace**. Theta Lake has **100+** integrations, including **Verizon, AT&T, Movius, CellTrust** mobile capture and **OpenAI, Claude and Copilot**. LeapXpert's archive partners are Smarsh, Global Relay and Theta Lake | **Critical path.** Every Alpha transcript, message and agent action a regulated firm produces must land in the firm's archive. A certified Theta Lake or Smarsh connector is a prerequisite for sale and a co-sell route | [Smarsh](https://www.smarsh.com/partners/); [Theta Lake](https://thetalake.com/integrations/); [LeapXpert](https://www.leapxpert.com/partners/) |
| Demand driver | SEC: **$392.75M**, **26 firms**, Aug 2024 (Ameriprise, Edward Jones, LPL and Raymond James paid **$50M** each); ≈$2B across 100+ firms over the whole sweep. Under Chair Atkins (2025–) the SEC signals lower priority for recordkeeping cases, though rules are unchanged | Compliance hygiene rather than fine avoidance | [SEC](https://www.sec.gov/newsroom/press-releases/2024-98) |
| Benchmark: **Jump** | **$100/advisor/month** (monthly) or about $80 (annual). Onboard and Grow add-ons are $50 each (about $40 annual) | Price anchor for the finance vertical | [Jump](https://jump.ai/pricing) |

### 1.7 Education

- **E-rate** funds Category One (data transmission and internet access) and Category Two (internal connections) for educational purposes ([USAC ESL](https://www.usac.org/e-rate/applicant-process/before-you-begin/eligible-services-list/)).
- Voice and handsets are not eligible (est.: USAC's current Eligible Services List covers only data transmission/internet access and internal connections, and its VoIP guidance applies only to FY2014 and earlier, consistent with the voice phase-out). **E-rate is not a channel for Alpha.**
- **State purchasing cooperatives** can supply a vehicle if a K-12 or higher-education use case appears. These include Sourcewell, OMNIA Partners (which absorbed Premier's non-healthcare GPO; [Wikipedia](https://en.wikipedia.org/wiki/Premier,_Inc.)), NASPO ValuePoint and TIPS.
- FERPA and COPPA exposure makes student-facing use unattractive. Only staff-facing use is plausible (est.).

### 1.8 International

- **Nordics and EU sovereign.** Bittium had 2025 revenue of **€119.3M** and signed a joint Finnish–Swedish defence framework agreement in **Nov 2025** ([Wikipedia](https://en.wikipedia.org/wiki/Bittium_(company))). HMD Secure builds the Bittium Tough Mobile 3 hardware in Finland ([Evertiq via 03](https://evertiq.com/news/2025-09-09-hmd-to-manufacture-bittiums-military-phone-in-finland)), which arrives in 2027 per Bittium's product page ([Bittium](https://www.bittium.com/defence-security/bittium-tough-mobile-3/)). The 03 file cites 2026 deliveries.
- **Middle East.** Katim (UAE) is the sovereign benchmark (see 03). Cerebras's largest 2025 customers were MBZUAI (**62%**) and G42 (**24%**) ([Wikipedia](https://en.wikipedia.org/wiki/Cerebras)). A Cerebras co-sell into the UAE is plausible (est.).
- **Broadline distribution** (TD SYNNEX, Ingram) fits only after reference customers exist.

---

## 2. Technology partners

| Partner | What Alpha needs | Terms and facts | Risk | Source |
| --- | --- | --- | --- | --- |
| **Google: Pixel hardware** | The reference device | Pixel 10 **$799**, 10 Pro **$999**, 10 Pro XL **$1,199**. **7 years** of OS and security updates. 10 Pro has 16 GB RAM. Tensor G5 is made on TSMC N3E, with an Exynos 5400 modem | Google competes with Gemini on-device and Recorder features | [Google](https://blog.google/products/pixel/google-pixel-10-pro-xl/); [Wikipedia](https://en.wikipedia.org/wiki/Pixel_10) |
| **Google: Play and managed Play** | App distribution to consumers and enterprises | Play service fee in the US: subscriptions **10% service fee + 5% Google Play Billing fee**. Since **2026-06-30** (US, UK, EEA) developers may use their own billing or link to web checkout and pay the 10% service fee plus their own processor costs instead of the 5% billing fee ([Android Developers Blog](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html)). Enterprise invoices outside Play carry no fee | App-review policy on accessibility and default-HOME behavior | [Play fees](https://support.google.com/googleplay/android-developer/answer/112622) |
| **Google: GMS/MADA** | **Not needed** (Alpha's AOSP image ships without GMS) | GMS is licensed "without any licensing fees except in the EU". The EU fee after the 2018 ruling was reported as **up to $40 per device** for high-ppi devices in top-tier countries ($2.50–$40 by country tier and ppi, per 9to5Google's report of documents obtained by The Verge). Requires CTS/GTS and approval | Not available for re-signed Pixel images; not pursued | [Wikipedia](https://en.wikipedia.org/wiki/Google_Mobile_Services); [9to5Google](https://9to5google.com/2018/10/19/android-eu-deal-google-app-suite-cost/) |
| **Google: Play Integrity** | Banking, wallet and some enterprise apps depend on it | Custom verified-boot keys **fail device and strong integrity**. Apps can instead check hardware attestation (`verifiedBootState = SelfSigned` plus a pinned key fingerprint). Relocked custom-key devices boot in **YELLOW** state with a warning screen | **Not a blocker** (no banking or Wallet apps on Alpha's image). Remaining work: document the YELLOW boot screen for buyers, and offer an "Alpha attestation allow-list" to partner apps that need device trust | [GrapheneOS](https://grapheneos.org/articles/attestation-compatibility-guide); [AOSP](https://source.android.com/docs/security/features/verifiedboot/device-state) |
| **Google: Android Enterprise partner** | Listing in the solutions directory | **Silver** and **Gold** tiers | Low cost, high credibility | [Partners](https://androidenterprisepartners.withgoogle.com/) |
| **Qualcomm** | On-device ASR/TTS for non-Pixel and rugged devices | AI Hub offers **300+** optimized models, device-cloud profiling on **50+** Qualcomm devices, and Argmax WhisperKit on Qualcomm | Pixel uses Tensor, not Snapdragon, so porting doubles the work | [AI Hub](https://aihub.qualcomm.com/) |
| **MediaTek** | Low-cost ODM devices | n/d | Chinese-ODM supply chains dominate | — |
| **Samsung Knox** | Second device family. Knox has CSfC listing | See §1.2 | A Samsung port is the fastest route to CSfC-eligible hardware (est.) | [FedScoop via 03](https://fedscoop.com/samsung-knox-nsa/) |
| **HMD / HMD Secure** | EU-made secure hardware | Manufacturing via **FIH Mobile** (Foxconn) generally; HMD Secure makes Bittium's TM3 in Finland. HMD **left the US market in Sept 2025**. HMD Terra M is Intune-AOSP-listed | Hardware and ODM partner for EU sovereign deals | [Wikipedia](https://en.wikipedia.org/wiki/HMD_Global); [Intune AOSP](https://learn.microsoft.com/en-us/mem/intune/fundamentals/android-os-project-supported-devices) |
| **Fairphone** | Repairable EU-brand device | Gen. 6 **€599**. Sales: **145,259** units in 2025, 103,053 in 2024. Built by **Hi-P in Suzhou, China**, so not TAA-compliant | Good for an EU privacy and consumer brand, not US government | [Wikipedia](https://en.wikipedia.org/wiki/Fairphone) |
| **Bittium** | Partner or competitor in EU defence | TM2C lists at **$4,499.99** at a reseller. TM3 hardware is built by HMD Secure in Finland | Could license Alpha as a secure-agent layer | [03 file](03-secure-phones-confidential-ai.md) |
| **Sonim** | Rugged, carrier-certified | Revenue: Q1 2025 **$16.7M**, Q2 **$11.2M**, Q3 **$16.2M**. FirstNet-certified XP3plus. **Social Mobile** agreed to acquire it | Social Mobile is a US-based custom-device maker and a candidate US ODM (est.) | [Sonim IR via 03](https://ir.sonimtech.com/news-events/press-releases/detail/276/sonim-technologies-reports-third-quarter-2025-financial) |
| **Zebra** | Enterprise rugged Android with Snapdragon | 2025 revenue **$5.40B**. Bought Elo for **$1.3B** (Aug 2025). Zebra WS50 is Intune-AOSP-listed | Frontline healthcare and logistics. Alpha as an app | [Wikipedia](https://en.wikipedia.org/wiki/Zebra_Technologies) |
| **Foxconn/FIH, Huaqin, Wingtech** | Mass ODM | FIH runs a Hanoi plant and makes HMD devices. **Wingtech was Entity-Listed Dec 2024** and the Dutch government took control of its Nexperia unit (Oct 2025) | China and entity-list exposure. Not for government products | [FIH](https://en.wikipedia.org/wiki/FIH_Mobile); [Wingtech](https://en.wikipedia.org/wiki/Wingtech) |
| **Cerebras** | Inference | `qwen-3.8-27b` **$0.99/M in, $1.49/M out**, ~1,850 tokens/s, 128K context on paid tiers, prompt caching supported, production status; Qwen runs at high reasoning intensity by default ([Cerebras docs](https://inference-docs.cerebras.ai/models/qwen-3.8-27b)). Cerebras states zero data retention for inference prompts and outputs, with US-based datacenters ([Cerebras support](https://support.cerebras.net/articles/1811589793-does-cerebras-retain-my-data); contract terms still needed). 2025 revenue **$510M** (+76%), with **86% from UAE entities** (MBZUAI 62%, G42 24%). **IPO 14 May 2026** on Nasdaq (CBRS): 30M shares at $185, **$5.55B** raised. **AWS collaboration (2026-03-13)** pairs Trainium3 prefill with CS-3 decode behind Amazon Bedrock. OpenAI deal reported at >$10B; the S-1 backlog of $24.6B is mostly an OpenAI order for 750 MW through 2028 | Customer concentration. Inference is **outside** the Nitro trust boundary: prompts leave the enclave in plaintext to Cerebras (see 03). Whether Qwen3.8 is offered through Bedrock or GovCloud is unconfirmed | [CNBC](https://www.cnbc.com/2026/05/14/cerebras-cbrs-stock-trade-nasdaq-ipo.html), [TechTimes](https://www.techtimes.com/articles/316698/20260515/cerebras-raises-555-billion-ai-chip-ipo-86-revenue-dependence-uae-entities-unresolved.htm), [AWS](https://press.aboutamazon.com/aws/2026/3/aws-and-cerebras-collaboration-aims-to-set-a-new-standard-for-ai-inference-speed-and-performance-in-the-cloud), [Yahoo](https://finance.yahoo.com/markets/stocks/articles/breaking-down-ai-chipmaker-cerebras-225603481.html), [Wikipedia](https://en.wikipedia.org/wiki/Cerebras) |
| **AWS** | Nitro, GovCloud, Marketplace | Nitro Enclaves carry **no extra charge** and are unsupported on bare-metal, burstable and single-core instances. **GovCloud supports Nitro Enclave attestation**: the `aws-us-gov` partition has its own attestation PKI root, but the Nitro Enclaves Developer AMI is not on GovCloud Marketplace. Marketplace fees: SaaS **3%**; private offers **3% / 2% / 1.5%** by contract value (<$1M / $1–10M / ≥$10M); renewals 1.5%; **CPPO +0.5%** | Marketplace listings let customers spend down committed AWS budgets, which shortens procurement | [Nitro FAQ](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/); [GovCloud EC2](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-ec2.html); [Marketplace fees](https://docs.aws.amazon.com/marketplace/latest/userguide/listing-fees.html) |
| **Speech vendors** (fallback before on-device is ready) | ASR/TTS | Deepgram streaming **$0.0048–$0.0078/min**; TTS $0.045/1K characters. AssemblyAI streaming **$0.15/hr**; Pro realtime $0.45/hr; streaming diarization +$0.12/hr; PII redaction +$0.08/hr. ElevenLabs Scribe v2 **$0.22/hr**, realtime $0.39/hr; Flash TTS **$0.04/1K characters** | Every hour of audio sent to a vendor weakens the privacy claim. Use only as an opt-in fallback | [Deepgram](https://deepgram.com/pricing); [AssemblyAI](https://www.assemblyai.com/pricing); [ElevenLabs](https://elevenlabs.io/pricing/api) |

---

## 3. Unit economics

### 3.1 Hardware BOM: Pixel-class versus custom ODM

No public Pixel 10 BOM is available; the TechInsights reports are paywalled. The estimate below uses Google's **retail repair-part prices** as upper bounds. Repair parts retail at roughly 2–3× their component cost (est.).

| Component | Pixel 10 Pro repair price | Est. BOM cost, Pixel-class (est.) | Est. BOM, custom mid-range ODM on Snapdragon 7-class, 8 GB/256 GB (est.) |
| --- | --- | --- | --- |
| Display (OLED) | $249.99 | $60–90 | $30–45 |
| Rear cameras | $199.99 | $45–70 | $15–30 |
| Front camera | $59.99 | $5–10 | $3–6 |
| Battery | $42.99 | $8–12 | $6–10 |
| Back glass/housing | $99.99 | $20–35 | $10–20 |
| SoC plus modem (Tensor G5 on N3E, Exynos 5400) | n/a | $80–120 | $35–60 |
| Memory (16 GB LPDDR5X) and storage (128–256 GB) | n/a | $60–90 | $35–55 |
| RF front end, PCB, power management, audio, sensors, misc. | n/a | $50–80 | $35–55 |
| Assembly, test, packaging, logistics | n/a | $20–30 | $15–25 |
| **Total** | — | **$350–520 (est.)** | **$185–300 (est.)** |
| Retail or target price | $999 ([Google](https://blog.google/products/pixel/google-pixel-10-pro-xl/)) | — | $499–$799 target (est.) |

Repair prices are from [9to5Google](https://9to5google.com/2025/10/03/pixel-10-repair-parts/). The Pixel 10's parts are cheaper: screen $159.99, rear camera $159.99, back glass $89.99. All BOM figures are analyst estimates.

**Custom-device fixed costs (all est.)**

| Item | Estimate | Basis |
| --- | --- | --- |
| ODM NRE for a design on an existing reference platform | $0.8–2.5M | Analyst estimate. Varies with how much the design is customized |
| Full custom industrial design and RF | $3–8M | Same |
| MOQ | 5k–20k units per SKU from tier-2 ODMs; 50k+ from tier-1 | Industry practice (est.). Fairphone sells about 100–145k units a year ([Wikipedia](https://en.wikipedia.org/wiki/Fairphone)) |
| Certification: FCC, PTCRB and three US carriers | $0.4–1.8M and 6–12 months | §1.1 table (PTCRB fee from [ptcrb.com](https://www.ptcrb.com/); the rest est.) |
| AER and GMS approval (if Play is wanted) | $0.2–0.5M plus lab time | Est. |
| OS maintenance: monthly patches for 5–7 years | 6–15 engineers (est.), i.e. $1.5–4M a year | Est. AER requires a published patch cadence ([AER](https://www.android.com/enterprise/recommended/requirements/)) |
| Cautionary tale | Foxconn sued Sirin Labs for ~**$5.9M** unpaid on its Finney phone | [Nasdaq via 03](https://www.nasdaq.com/articles/sirin-labs-founder-sued-over-unpaid-$6m-factory-bill-for-finney-blockchain-phone-2020-08) |

**Break-even.** A custom device costs about $3–8M up front plus $1.5–4M a year to maintain (est.). At a **$150 hardware gross margin** per unit, it breaks even at roughly **30k–80k units** (est.). That volume only makes sense with a funded anchor order, for example a national defence framework.

### 3.2 Per-user inference and hosting cost

**Workload assumptions (est.).** Agent turns carry about 8k input tokens (system prompt, memory, tool schemas, conversation) and about 600 output tokens. Prompt-caching discounts are not assumed; Cerebras's caching discount is not published.

| Profile | Turns per day | Monthly tokens (in / out) | Cerebras Qwen3.8 27B cost | Sensitivity only (not planned): 60% of traffic on a cheaper model |
| --- | --- | --- | --- | --- |
| Light | 15 | 3.6M / 0.27M | **$3.97** | $2.46 |
| Typical | 50 | 12M / 0.9M | **$13.22** | $8.21 |
| Heavy | 150 | 36M / 2.7M | **$39.67** | $24.64 |
| Meeting digests, extra (2 h/day of transcripts, ~1.5M tokens in / 0.1M out a month) | — | — | **$1.63** | — |

Prices are $0.99/M in and $1.49/M out ([Cerebras docs](https://inference-docs.cerebras.ai/models/qwen-3.8-27b)). Worked example for the typical profile: 12 × 0.99 + 0.9 × 1.49 = $13.22. The right-hand column is a sensitivity using pricepertoken's other Cerebras listing ([pricepertoken](https://pricepertoken.com/endpoints/cerebras)); inference stays on Qwen, so it is not a plan.

**Two sensitivities that matter more.** (1) **Reasoning tokens.** Cerebras notes Qwen3.8 runs at high reasoning intensity by default, and reasoning tokens bill as output. If output tokens triple (600 → 1,800 a turn), typical-user cost rises from $13.22 to 12 × 0.99 + 2.7 × 1.49 = **$15.90**, and heavy from $39.67 to **$47.71** (est.). (2) **Prompt caching.** Cerebras lists prompt caching as supported for Qwen3.8; its discount is not published. Because ~90% of cost here is input tokens, a cached system prompt and tool schema could cut cost materially. Measure both in the pilot.

**Cerebras model catalog.** Cerebras's model catalog lists two shared-inference models, including `qwen-3.8-27b`, and the Qwen3.8 model page gives $0.99/M in and $1.49/M out ([Cerebras catalog](https://inference-docs.cerebras.ai/models/overview), [Qwen3.8 page](https://inference-docs.cerebras.ai/models/qwen-3.8-27b)). Enterprise contract pricing may differ.

**Nitro Enclave hosting**

| Deployment | Instance | Price | Per-user cost | Source |
| --- | --- | --- | --- | --- |
| Shared multi-tenant enclave (50 active users per instance, 2× for high availability) | m7i.xlarge (4 vCPU, 16 GiB) | $0.202/h on demand = **$147/month** | **$5.90** on demand; **$3.88** reserved at $0.133/h (est.) | [Vantage](https://instances.vantage.sh/aws/ec2/m7i.xlarge) |
| Dedicated enclave per owner (the pairing model binds an "instance ID"; see [enclave-candidate-validation.md](https://github.com/eliza-research/alphaphone/blob/d0a9db7829f7546668af46752bac57c6a339c7dd/docs/enclave-candidate-validation.md)) | m7i.xlarge. Single-core instances cannot run an enclave | **$97–147/month per user** | same | [Nitro FAQ](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/) |
| Compute-optimized alternative | c7i.2xlarge (8 vCPU, 16 GiB) | $0.357/h on demand; $0.236/h 1-year reserved | — | [Vantage](https://instances.vantage.sh/aws/ec2/c7i.2xlarge) |

**Reserved pricing.** Vantage has shown two different 1-year reserved rates for m7i.xlarge, $0.091/h and $0.133/h; this report uses the more conservative $0.133/h. GovCloud typically carries a premium over commercial regions (est.).

**Speech costs.** On-device speech has zero marginal cost. Cloud fallback for 44 hours of audio a month (2 h/day, 22 days) costs **$6.60** at AssemblyAI streaming ($0.15/h) and **$17.16** at ElevenLabs realtime ($0.39/h) ([AssemblyAI](https://www.assemblyai.com/pricing); [ElevenLabs](https://elevenlabs.io/pricing/api)). Always-on capture at 8 h/day runs about **$26–69/month**. This is the economic case for the on-device speech requirement, on top of the privacy case.

### 3.3 Worked gross margin per user per month

**Common COGS stack, typical user (all est. except where sourced).**

| Item | Amount |
| --- | --- |
| Cerebras inference | $13.22 |
| Meeting digests | $1.63 |
| Shared enclave compute (reserved) | $3.88 |
| Storage, KMS, logs, egress | $1.50 |
| Speech fallback, blended (on-device is the default) | $2.00 |
| Support and customer success | $3.00 |
| Archive connector pass-through (finance; e.g. Theta Lake or Smarsh) | $0 (customer pays the archiver) |
| **Subtotal** | **$25.23** |

**(a) Software-only launcher or app on the customer's Pixels**

| Tier | Price/month | Channel fee | COGS, typical | Gross margin | GM, heavy user (COGS $51.68) |
| --- | --- | --- | --- | --- | --- |
| Pro (prosumer and SMB) | $30 | Play 15% = $4.50 ([Play](https://support.google.com/googleplay/android-developer/answer/112622)) | $25.23 | **$0.27 (1%)** | **−$26 (loss)** |
| Business (direct or AWS Marketplace) | $59 | 3% = $1.77 ([AWS](https://docs.aws.amazon.com/marketplace/latest/userguide/listing-fees.html)) | $25.23 | **$32.00 (54%)** | $5.55 (9%) |
| Regulated vertical (finance or health) | $129 | 3.5% CPPO = $4.52 | $25.23 | **$99.25 (77%)** | $72.80 (56%) |
| Same vertical, reasoning output tripled (sensitivity) | $129 | $4.52 | $27.91 | **$96.57 (75%)** | — |

The regulated-vertical price sits between Jump ($80–100) and Abridge (~$208/month equivalent) ([Jump](https://jump.ai/pricing); [Sacra](https://sacra.com/c/abridge/)).

**Takeaway.** A prosumer tier priced like Otter ($8.33–$19.99; [Otter](https://otter.ai/pricing)) or Plaud ($99.99–$239.99 a year; [Plaud](https://www.plaud.ai/products/plaud-notepro-unlimited-plan); Note Pro is $189) **loses money** at Alpha's token intensity unless it has hard usage caps and effective prompt caching.

**(b) Device-as-a-service bundle (Pixel 10 plus Alpha, 36-month term)**

| Item | $/month (est.) | Basis |
| --- | --- | --- |
| Pixel 10 at $799 less a 10% volume discount = $719, amortized over 36 months | 19.97 | [Google](https://blog.google/products/pixel/google-pixel-10-pro-xl/) price; discount est. |
| Cost of capital at 9% APR (average balance) | 2.75 | est. |
| Repair and loss reserve (8% of device cost a year) | 4.79 | est.; screen $159.99 ([9to5Google](https://9to5google.com/2025/10/03/pixel-10-repair-parts/)) |
| Zero-touch provisioning, kitting, logistics ($60 one-time) | 1.67 | est. |
| MDM (Workspace ONE Mobile Essentials, if Alpha supplies it) | 3.00 | [Omnissa](https://www.omnissa.com/products/workspace-one-unified-endpoint-management/) |
| Software COGS (typical user) | 25.23 | above |
| **Total COGS** | **57.41** | |
| **Price: $149/month** (excluding the carrier line) | GM **$91.59 (61%)** before fees; ≈$87.12 (58%) after 3% fees (est.) | |
| Sensitivity: Pixel 11 at $899 instead of Pixel 10 at $799 | +≈$3.44/month (amortization, capital and reserve scale with price); GM after fees ≈$83.68 (56%) (est.) | [Engadget](https://www.engadget.com/2234844/google-pixel-11-announced-specs-availability/) |
| Price with an Alpha-built ODM device at $260 BOM plus $1.5M NRE over 20k units ($75) | Hardware amortization ≈ $9.3/month. GM improves by ~$10/month, but only at ≥20k units and with the certification risk above | §3.1 |

**(c) Sovereign or on-prem enterprise licence (customer-hosted enclaves and inference)**

| Item | Year 1 | Year 2+ | Basis |
| --- | --- | --- | --- |
| Platform licence | $300,000 | $300,000 | est. Hypori's contract sizes of $4.1M and $12M ([03 file](03-secure-phones-confidential-ai.md)) show where the ceiling is |
| Seats: 1,000 × $360 a year ($30/month; the customer pays for inference) | $360,000 | $360,000 | est. |
| **Revenue** | **$660,000** | **$660,000** | |
| Deployment engineering (3 FTE-months at $25k) | $75,000 | $0 | est. |
| Dedicated support and SRE (0.75 FTE) | $150,000 | $150,000 | est. |
| Accreditation support (ATO package, pen test) | $100,000 | $40,000 | est. |
| **Gross margin** | **$335,000 (51%)** | **$470,000 (71%)** | |

The customer supplies inference capacity. Options include a GPU server running open-weight Qwen 27B on one 80 GB GPU (per 03, est.), Cerebras on-prem, or Cerebras through AWS Bedrock ([Wikipedia](https://en.wikipedia.org/wiki/Cerebras)). Alpha's COGS falls to people costs, so margin depends on standardizing deployment.

**Executive tier with a dedicated enclave (option c-lite).** Dedicated compute costs $97–147 a month and heavy-user inference $40, so COGS is about $150–190 (est.). Price it at **$399–$499/month** for a 60%+ margin.

### 3.4 Competitor pricing comparison

| Product | Price | Model | Source |
| --- | --- | --- | --- |
| Plaud Note | **$159** device, including 300 min/month free | Hardware plus subscription | [Plaud](https://www.plaud.ai/products/plaud-note-ai-voice-recorder) |
| Plaud Pro / Unlimited | **$99.99 / $239.99** a year; 3,000-minute pack $59.99 | Subscription | [Sacra](https://sacra.com/c/plaud/) |
| Plaud scale | **$250M** annualized revenue (Sept 2025); 2M+ devices. Sacra also cites "$100M ARR in June 2026", apparently software only. **Contradiction:** the two metrics are not comparable | — | [Sacra](https://sacra.com/c/plaud/) |
| Otter | Pro $8.33 (annual) / $16.99 (monthly). Business $19.99 (annual) / $30 (monthly). Enterprise custom | Seat | [Otter](https://otter.ai/pricing) |
| Abridge | ~**$2,500/clinician/year** (Sacra estimate; market estimates range to $7,200+). ARR $100M (May 2025). $5.3B valuation (June 2025) | Enterprise seat | [Sacra](https://sacra.com/c/abridge/) |
| Jump | **$100/advisor/month**, about $80 annual (annual saves up to 20%). Add-ons $50 (about $40 annual) | Seat | [Jump](https://jump.ai/pricing) |
| Hypori | Not public ("custom pricing"). Contracts of $4.1M (USAF/Space Force) and $12M (Army renewal) | Seat or enterprise | [Hypori](https://www.hypori.com/pricing); [03 file](03-secure-phones-confidential-ai.md) |
| Bittium Tough Mobile 2C | **$4,499.99** (reseller). Government pricing by quote | Device plus server licence | [03 file](03-secure-phones-confidential-ai.md) |
| Intune / Workspace ONE | $8/user; $3–15.63/device | MDM seat | [Intune](https://www.microsoft.com/en-us/security/business/microsoft-intune-pricing); [Omnissa](https://www.omnissa.com/products/workspace-one-unified-endpoint-management/) |

---

## 4. Partnership and distribution sequencing, months 0–24

| Phase | Months | Distribution | Partners to sign | Exit gate (evidence, not claims) |
| --- | --- | --- | --- | --- |
| **0. Qualify the product** | 0–3 | Direct to 5–10 design partners on **stock Pixel 10**. Standalone plus launcher APK through managed Google Play (private app) | Cerebras enterprise agreement for committed Qwen3.8 pricing and data terms. AWS Activate/ISV Accelerate | MVP acceptance per [mvp-scope-and-gap-report.md](../mvp-scope-and-gap-report.md). On-device STT/TTS measured. COGS per user measured, not modeled |
| **1. Enterprise-manageable software** | 3–9 | Intune and Workspace ONE deployment guides (managed configuration, persistent HOME via fully-managed mode). **AWS Marketplace SaaS listing** (3%) | Android Enterprise partner directory (Silver). **Theta Lake and Smarsh** archive connectors. Redtail/Salesforce FSC integration. 1–2 RIA or broker-dealer pilots | 3 paying finance logos at ≥$99/user; an archive connector certified by a partner |
| **2. Government entry** | 6–15 | **Carahsoft** as master distributor. DIU CSO or service OTA prototype. GovCloud deployment with its own `aws-us-gov` attestation root | Carahsoft. One SI teammate (Booz Allen or Leidos) for a named program. **Samsung Knox port** evaluation for CSfC-listed hardware | OTA award or Success Memo; FedRAMP/IL plan funded |
| **3. Device-as-a-service** | 9–18 | Bundle Pixels through a **carrier business channel or CDW/SHI** as zero-touch reseller. $149/month, 36-month term | Carrier business-solutions team (Verizon or T-Mobile). A leasing partner to keep devices off the balance sheet | 1,000+ bundled seats; loss and repair rates measured |
| **4. Sovereign and on-prem** | 15–24 | Licence (model c) through Carahsoft or AWS Marketplace GovCloud private offers. **AOSP vendor add-on** for air-gapped or sovereign customers | Cerebras Bedrock or on-prem. HMD Secure or Bittium (EU); Social Mobile or Sonim (US rugged) for any custom SKU. **Build no custom hardware without an anchor order of ≥20k units** | One sovereign contract ≥$500k |
| **5. Healthcare and international** | 18–24+ | Epic Connection Hub listing. Vizient or Premier only after references | Leidos health; EU distributors via TD SYNNEX; Cerebras/G42 introductions in the UAE | — |

**Do not do early:**

- carrier certification of a custom device;
- a GSA MAS contract in Alpha's own name (ride Carahsoft);
- E-rate;
- GMS/MADA negotiations;
- prosumer pricing below $30/month.

---

## Implications for Alpha Phone

1. **Ship on stock Pixel as a managed app plus launcher for fleets that already run Intune or Workspace ONE; ship Alpha's own AOSP image where Alpha controls the device.** The image does not need banking apps, Play Integrity or GMS, so those are not blockers. The channel cost that remains is MDM: Intune's AOSP allow-list still contains only one phone (HMD Terra M), so a custom-image fleet needs an MDM partner allow-list or Alpha-provided management, plus buyer documentation of the YELLOW boot screen.
2. **Price by vertical at $99–149/user/month, with token budgets.** At Cerebras list prices, inference alone costs about $13/month for a typical user and $40 for a heavy user. Prosumer pricing in the $8–20 range cannot cover it without usage caps and prompt caching.
3. **Architecture decides margin.** A dedicated Nitro Enclave per owner costs about $100–150/month before any tokens. Build multi-tenant enclaves with per-owner cryptographic isolation for standard tiers, and reserve dedicated enclaves for an executive or sovereign price of $399+.
4. **On-device speech is required for margin as well as privacy.** Cloud ASR for an always-on user costs $26–69/month.
5. **Treat the compliance-archive integration as a distribution partnership.** Theta Lake, Smarsh and Global Relay already capture Verizon/AT&T mobile, Copilot and Claude. An Alpha connector turns "AI on a phone" from a compliance risk into a captured channel, and gives Alpha co-sell partners.
6. **Government: OTA plus Carahsoft, pitched as an agent on NIAP/CSfC-listed commodity devices, not a new phone.** Samsung Knox is the fastest route to CSfC-eligible hardware. TAA and §889 rule out Chinese-ODM custom hardware.
7. **The Cerebras dependency is also a channel.** The AWS collaboration (Bedrock) and the G42/MBZUAI concentration (86% of 2025 revenue from UAE entities) open GovCloud and UAE doors, and may raise questions from US government buyers. Inference leaves the enclave trust boundary, and customers and procurement will ask about that. Cerebras publicly states zero data retention; get it in the contract with data-processing terms. Some buyers will also raise Qwen's Chinese origin (Alibaba). The answer is about Qwen itself, not a model swap: offer self-hosted Qwen open weights inside the customer's or Alpha's trust boundary for sovereign tiers, redact before any prompt leaves the device or enclave, and keep a provenance file (weights source, hashes, licence, evaluation results).
8. **Custom hardware is a year-2 option that needs a customer.** $3–8M in fixed costs and $1.5–4M a year in maintenance (est.) require about 30k–80k units, which means an anchor order.

## Open questions

1. What is Cerebras's contracted enterprise price for Qwen3.8, its prompt-caching discount and batch pricing, and is Qwen3.8 offered through AWS Bedrock or in GovCloud?
2. What is the actual agent footprint (RAM/vCPU) per owner, and can one enclave safely host several owners? This decides whether standard-tier compute costs $4 or $120 per user.
3. Will Google allow an AOSP image with Alpha keys on Pixel for enterprise fleets? Is any Pixel-for-Business or Android Partner path available to a third-party OS?
4. Will Microsoft or Omnissa add an Alpha AOSP build to their AOSP device lists, and what does that cost?
5. What does it cost to certify archive connectors with Theta Lake, Smarsh and Global Relay, and what are their revenue shares?
6. Will Carahsoft onboard a pre-FedRAMP product?
7. What are the actual MOQ/NRE quotes from HMD Secure, Social Mobile or Sonim, and the real Pixel 10 BOM (TechInsights or Counterpoint licence)?
8. What are Knox Suite pricing and Samsung partner-program terms?
9. What are the actual carrier-acceptance cost and time for a custom-software Pixel? Is PTCRB re-certification triggered by an OS change without a radio change?
10. What is Hypori's per-seat price (a GSA Advantage price list), for anchoring BYOD government pricing?
11. What are the requirements and fees for the FirstNet Ready and T-Priority device and app programs?
12. What per-user token usage does the MVP pilot measure? It replaces all the usage profiles above.
