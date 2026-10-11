# GEvents backend i plan za 46 sati

> For agentic workers: execute tasks inline using executing-plans, with test-driven-development and verification-before-completion. Track completed work below.

**Goal:** Povezati postojeci frontend sa zajednickim podacima i serverskom proverom prijava, timova i poziva, a zatim dokazati korisnost na hakatonu. Korisnik je naknadno prosirio GEvents na business, study i science dogadjaje; BelPal ostaje za druzenje i zabavu.

**Architecture:** React salje tipizirane komande API-ju. Server validira payload, utvrdjuje identitet i ovlascenja, i koristi postojeci `transition` kao jedini izvor poslovnih pravila. Lokalni backend cuva podatke na disku; Firebase rezim koristi proverene Firebase ID tokene i Firestore transakcije. UI dobija samo podatke dozvoljene trenutnom korisniku.

**Tech Stack:** React/TypeScript/Vite, Node HTTP, Zod, Firebase Authentication/Admin/Firestore, Vitest, Playwright.

## Global constraints

- Postojeci dizajn i tokovi ostaju osnova.
- Prihvatanje poziva i odobrenje prijave ostaju odvojeni statusi.
- Server proverava identitet; `personId` ili `mode` iz browsera ne daju privilegije.
- Lokalno menjanje demo osobe postoji samo u izricitom demo rezimu sa fiktivnim podacima.
- Firebase rezim nikada ne pada automatski nazad na demo autentifikaciju.
- Privatni kljucevi ne ulaze u frontend ni repozitorijum; server koristi Application Default Credentials.
- Bez automatskog slanja poziva, LinkedIn/Kaggle importa, judge agenta ili prosirenja igre u ovoj fazi.
- Firestore adapter u ovom pilotu cuva jedan transakcioni dokument. Nije arhitektura za veliko trziste: pre rasta razdvojiti kolekcije po dogadjaju i ukloniti zajednicko mesto upisa.

## Trenutno stanje

- `src/domain.ts` vec sadrzi pravila i validacije timova/prijava.
- `src/store.tsx` sada ucitava i menja stanje kroz API; browser cuva samo sesiju i izbor prikaza.
- `src/components/forms.tsx`, `src/pages/Organizer.tsx`, `src/pages/Teams.tsx`, `src/pages/Activity.tsx` sada cekaju asinhroni serverski rezultat kroz `await run(action)`.
- Ne postoji Git repozitorijum u ovom direktorijumu; raditi na postojecim fajlovima bez resetovanja.

## Task 1: Serverska komanda i ovlascenja

Files: `server/schema.ts`, `server/service.ts`, `server/service.test.ts`.

- [x] Dodati testove za neovlasceno odobrenje, lazni identitet, izmenu tudjeg profila, privatne prijave i tuđe notifikacije.
- [x] Pokrenuti `npm.cmd test -- server/service.test.ts` i potvrditi neuspeh zbog nedostajuce implementacije.
- [x] Implementirati `execute(state, session, input): Transition`, `view(state, session): DemoState` i Zod validaciju svih akcija.
- [x] Pozivati `transition` tek posle validacije i autorizacije. Nepoznata polja i tipovi vracaju citljivu gresku.
- [x] Potvrditi da ucesnik ne dobija tudju motivaciju, CV metadata, privatne pozive ni notifikacije.

## Task 2: Persistence, HTTP i Firebase

Files: `server/repository.ts`, `server/http.ts`, `server/index.ts`, `server/http.test.ts`, `firestore.rules`, `.env.example`, `tsconfig.server.json`.

Interfaces: `Repository.read(): Promise<DemoState>`; `Repository.update(fn): Promise<Transition>`; authenticated `/api/state` and `/api/actions`.

- [x] Testirati zajednicko stanje iz dve sesije, istovremene pozive za poslednje mesto, ponovno otvaranje lokalne datoteke i neautentifikovan HTTP zahtev.
- [x] Lokalni upisi se redjaju i atomski menjaju datoteku; Firestore upisi koriste transakciju.
- [x] U demo rezimu `/api/demo-session` izdaje vremenski ogranicen nepredvidiv token za fiktivni profil.
- [x] U Firebase rezimu verifikovati ID token; novi UID dobija svoj profil, a organizator se odredjuje serverskom UID listom.
- [x] Dodati ogranicenje velicine zahteva, same-origin proveru mutacija, strukturisane greske i zabranu direktnog klijentskog pristupa Firestore-u.
- [x] `npm.cmd run server:check` mora proci. Cloud verifikacija zahteva korisnikov projekat i ADC; ne predstavljati lokalni test kao cloud test.

## Task 3: Frontend integracija

Files: `src/backend.ts`, `src/store.tsx`, postojece forme i stranice, `src/App.tsx`, `vite.config.ts`, `scripts/dev.mjs`.

- [x] Implementirati API klijent sa timeoutom i Firebase Google prijavom prema serverskoj javnoj konfiguraciji.
- [x] Store prvo ucitava server; ne koristi seed ili localStorage kao zamenu za neuspesan API.
- [x] `run` vraca Promise; forme cekaju potvrdu pre zatvaranja ili navigacije.
- [x] Cuvati izbor prikaza u sesiji; prikaz organizatora ne daje serverska ovlascenja.
- [x] Sinhronizovati stanje pollingom bez preklapanja zahteva, sa zastitom od zastarelih odgovora i jasnom greskom veze.
- [x] Onemoguciti duple mutacije dok se prethodna zavrsava.
- [x] `npm.cmd run dev` pokrece API i Vite; preview proxy prosledjuje `/api` lokalnom serveru.

## Task 4: Provera i dokumentacija

Files: `scripts/verify-backend.mjs`, `README.md`, ovaj plan.

- [x] `npm.cmd run check`: domen, serverske autorizacije/HTTP/persistence, TypeScript i build.
- [x] Browser A poziva Zarka; browser B prihvata; organizer odobrava; browser A vidi potvrdu bez rucnog refresh-a.
- [x] Proveriti mobilni prikaz, greske browsera i prikaz gubitka veze bez lazne potvrde uspeha.
- [x] Dokumentovati lokalni demo naspram Firebase rezima, komande, ogranicenja i cloud setup.

## Plan hakatona: rokovi od pocetka preostalih 46 sati

| Period | Posao | Dokaz za grading |
| --- | --- | --- |
| 0-4 h | 2-3 organizatora i 5-6 ucesnika; proveriti najveci problem | Beleške, 3 nalaza, jasno definisana potreba |
| 4-16 h | Glavni tok kroz zajednicki backend i dva naloga | Prijava, odobrenje, poziv i prihvatanje na dva uredjaja |
| 16-24 h | Provera preporuka dogadjaja i napredne pretrage sa korisnicima | Razlozi preporuke, korisnost rangiranja i pronalazak odgovarajuceg eventa |
| 24-30 h | Testiranje zadatka sa korisnicima | Nalaz -> izmena -> rezultat ponovnog testa |
| 30-36 h | Stabilnost, arhitektura, konkurencija i troskovi | Izmerene granice, resen tehnicki izazov, scenario prihoda |
| 36-42 h | Slajdovi i 3 merene probe | Dosledna prica, stvaran demo i rezervni snimak |
| 42-46 h | Predaja i rezerva | Provereni linkovi, pristup, bez novih funkcija |

Rasporediti odmor u smenama. Ako glavni tok kasni do 16. sata, preporuku svesti na filtere. Posle 36. sata menjati samo kriticne greske.

## Poslovni i prezentacioni paket

- Primarni kupac: organizacija koja odrzava poslovne, obrazovne i naucne dogadjaje. Pocetni pilot moze biti GDG hakaton ili strucni meetup. Korisnici: organizatori, ucesnici, mentori, predavaci i sudije.
- Pocetna monetizaciona hipoteza: cena po dogadjaju; potvrditi budzet i odluku o kupovini razgovorom.
- Porediti sa rucnim formular/tabela/chat tokom, event alatom i hackathon platformom, uz izvore.
- Racunati prihod kao broj placenih dogadjaja puta cena; posebno infrastruktura, AI obrada, podrska i rad do pilota. Procene oznaciti.
- Pitch: problem -> korisnicki nalazi/izmena -> demonstracija -> Google arhitektura/izazov -> kupac i troskovi -> sledeci pilot i sirenje.

## Evidencija

Lokalna integracija je implementirana i proverena. Firebase adapter, Google sign-in, serverska verifikacija tokena, rules i Docker priprema postoje; cloud projekt jos nije dostavljen.

- [ ] Podesiti stvarni Firebase projekat, ADC/IAM, javnu web konfiguraciju i organizatorske UID-eve prema `docs/firebase-setup.md`.
- [ ] Proveriti stvarnu Google prijavu i Firestore upise iz dva naloga pre oznake da je cloud spreman.
- [ ] Sprovesti intervjue, preporuke kandidata i poslovnu/pitch pripremu iz vremenskog plana. To nije deo zavrsene backend integracije.

### Prosirenje na poslovne, obrazovne i naucne dogadjaje

- [x] Cetiri vrste dogadjaja: hackathon, conference, meetup i festival; postojece prijave i timovi sacuvani.
- [x] Objasnjive preporuke eventova prema interesovanjima, ciljevima, vestinama i logistici; privatne preference profila.
- [x] Napredna pretraga kombinuje tekst, vrstu, temu, lokaciju, format, datume i slobodna mesta, sa filterima u URL-u.
- [x] Pojedinacne prijave za nove vrste, organizatorsko odobrenje ili neposredna potvrda, serverski rokovi i kapacitet.
- [x] In-app obavestenja za prvi relevantan novi event, uz opt-in i deduplikaciju.
- [x] 64 testa, TypeScript/build, 28 starih browser provera, 8 backend provera, 10 event provera i 6 javnih Cloudflare provera.
- [ ] Izmeriti kvalitet preporuka sa stvarnim korisnicima; implementirani prag nije potvrda korisnosti.

Detalji: `docs/superpowers/specs/2026-10-10-event-discovery-design.md` i `docs/superpowers/plans/2026-10-10-event-discovery.md`. BelPal izmene nisu deo ovog direktorijuma niti ove implementacije. Firebase cloud provera i dalje ceka projekat i konfiguraciju.

### Provere lokalne implementacije

- `npm.cmd run check`: 51 test, serverski i frontend TypeScript, produkcioni build.
- `scripts/verify.mjs`: 28 provera postojecih tokova, desktop/390px, bez browser gresaka.
- `scripts/verify-backend.mjs`: odvojeni korisnici/browseri, pending versus accepted prijava, serversko cuvanje, neuspesan save, prazan workspace i zastareli Retry odgovor.
- `npm.cmd run dev`: API i Vite pokrecu se zajedno na zasebnim localhost portovima za proveru.
- Nezavisni code review pronasao race kod logout/Retry odgovora; dodata generation/lifetime zastita i kontrola completion stanja.
- `npm audit`: ranjiva tranzitivna gRPC verzija zamenjena kompatibilnom zakrpljenom verzijom putem override-a.

Korisnik je naknadno izricito odobrio javni Cloudflare preview za ovaj projekat. Potvrdjeno je da demo sadrzi tacno fiktivni seed, bez stvarnih CV upload-a ili Firebase podataka. Frontend i API sada su dostupni kroz isti javni tunel; aktuelni URL i PID-evi su u `.runtime/cloudflare-backend.json`. Plan prikazivati direktno u razgovoru, a preview ubuduce isporucivati kao Cloudflare link.
