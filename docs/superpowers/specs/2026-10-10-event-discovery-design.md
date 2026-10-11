# GEvents: dogadjaji i personalizovane preporuke

Status: korisnik je odobrio smer 2026-10-10: business, study i science za GEvents; druzenje i zabava za BelPal. GEvents MVP je implementiran i proverena je javna Cloudflare verzija; Firebase cloud konfiguracija jos nije dostavljena.

## Cilj

GEvents postaje platforma za otkrivanje poslovnih, obrazovnih i naucnih hakatona, konferencija, meetupova i festivala prema interesovanjima, vestinama i ciljevima korisnika. Organizator objavljuje dogadjaj i opisuje publiku; korisnik dobija preporuku sa razumljivim obrazlozenjem i obavestenje o novom relevantnom dogadjaju. BelPal ostaje zaseban proizvod za druzenje i zabavu; njegove preporuke i napredna pretraga pripadaju njegovom projektu.

## Razmotreni pristupi

1. Objasnjivo bodovanje na serveru: preporuceni MVP. Moze da radi sa postojecim profilima, proverava se deterministicki i svaka preporuka ima razlog.
2. Hibrid: isto bodovanje, uz Gemini za predlog oznaka iz opisa dogadjaja. Kasnija dopuna nakon stvarne Firebase konfiguracije i stabilnog osnovnog toka; organizator potvrdjuje predlozene oznake.
3. Personalizacija iz ponasanja: kasnija faza kada postoje stvarne interakcije i procena kvaliteta. MVP ne tvrdi da ima treniran model.

## Dogadjaji i prijave

- Uvesti opsti Event sa vrstama hackathon, conference, meetup i festival. Postojece dogadjaje migrirati kao hackathon bez gubitka prijava, timova ili poziva.
- Svi dogadjaji imaju naziv, organizatora, opis, datume, lokaciju, format, kapacitet, oznake, program i status objave.
- Organizator podesava teme, relevantne vestine, ciljne uloge i nivo iskustva. Prazan kriterijum znaci da nema ogranicenja po tom kriterijumu.
- Hackathon zadrzava solo/tim prijavu, pozive, velicinu tima i postojeca pravila odobravanja.
- Conference, meetup i festival koriste pojedinacnu prijavu. Organizator bira neposrednu potvrdu ili rucno odobravanje; ogranicenje kapaciteta proverava server u oba slucaja. Timovi i njihovi pozivi nisu dostupni za ove vrste.
- Preporuka ne odbija prijavu automatski. Eventualni obavezni uslovi prikazuju se zasebno i proveravaju kroz pravila prijave.
- Ovo prosirenje ne uvodi naplatu ulaznica niti sinhronizaciju sa spoljnim kalendarima.

## Profil i preporuke

- Postojeci profil dobija preferirane vrste dogadjaja, teme, ciljeve (ucenje, networking, gradjenje projekta, karijera, istrazivanje), zeljenu lokaciju i format, strukturisan nivo iskustva i prekidac za obavestenja o preporukama.
- Dopuna profila je dobrovoljna. Nedostajuci podatak ne znaci nepogodnost i ne dobija izmisljenu vrednost.
- Izbor kandidata iskljucuje draft, zavrsene i zatvorene dogadjaje. Ranije prijavljen dogadjaj ne dobija novi poziv za prijavu.
- Bodovanje koristi teme 35, ciljeve 25, vestine 20, ulogu/nivo 10 i lokaciju/format/vrstu 10. Ocena se normalizuje samo preko kriterijuma za koje postoji i profil i zahtev dogadjaja. Podudaranje liste je broj zajednickih oznaka podeljen brojem kriterijuma dogadjaja, ogranicen na 1. Za prikaz preciznog ranga potrebne su bar dve kategorije poznatih podataka; obavestenje dodatno trazi bar dva podudaranja.
- Profil sa nedovoljno podataka dobija poziv da dopuni profil i opste dogadjaje; ne dobija precizan procenat.
- MVP prikazuje oznaku relevantnosti i do tri konkretna razloga, npr. AI tema, cilj networking, online format. Broj bodova je rang za preporuku, ne verovatnoca prihvatanja.
- Prag za novu notifikaciju u pocetku je 60/100, uz najmanje dva proverljiva podudaranja. Prag je hipoteza za proveru sa korisnicima.
- Organizator ne vidi privatne preference niti rezultat tudjeg profila bez zasebne dozvole; preporuke se racunaju za autentifikovanog korisnika na serveru.

## Ekrani i obavestenja

- Navigacija Hackathons postaje Events. Postojece putanje ostaju kompatibilne preko preusmerenja.
- Events ima For you i All events, filter vrste, lokacije, formata i datuma. Kartica prikazuje vrstu i obrazlozenje preporuke.
- Napredna pretraga kombinuje tekst, vrstu, temu, lokaciju, format, raspon datuma i dostupna mesta; filteri se cuvaju u URL-u i mogu resetovati jednim potezom.
- Home prikazuje preporucene dogadjaje i nove relevantne objave.
- Organizer dobija izbor vrste, publike i nacina potvrde prijave; polja timova postoje samo za hackathon.
- Objavljivanje novog dogadjaja stvara jednu in-app notifikaciju po odgovarajucem korisniku koji je ukljucio obavestenja. Draft ne salje nista. Prelaz draft -> open smatra se prvom objavom; promena opisa vec objavljenog dogadjaja ne ponavlja notifikaciju.
- Identitet notifikacije vezuje korisnika i dogadjaj; transakcioni upis sprecava duplikate. Sadrzaj daje naziv, razlog preporuke i link.
- Korisnik moze iskljuciti preporuke; pozivi u tim i statusi postojecih prijava ostaju posebna obavestenja.
- Email i push nisu deo ovog MVP-a.

## Backend i provera

- Prosiriti tipove, Zod validaciju, migraciju lokalnog/Firestore stanja, domen i autorizovane API prikaze. Isti model i pravila koriste demo i Firebase adapter.
- Personalizovani rezultat se ne cuva kao zajednicko stanje koje drugi korisnici mogu da procitaju. Izracunava se za sesiju iz dozvoljenih podataka.
- Testirati migraciju starih podataka, svaki tip prijave, zabranu timova za druge tipove, kapacitet, hladni pocetak profila, razloge rangiranja, draft privatnost, opt-out i deduplikaciju notifikacija.
- U dva browser naloga objaviti relevantan meetup i proveriti notifikaciju, preporuku i prijavu; profil bez relevantnih interesovanja ne dobija tu notifikaciju.
- Proveriti desktop i mobilni prikaz i postojece hackathon tokove, zatim objaviti novi build kroz Cloudflare i proveriti javni link.

## Redosled rada u okviru hakatona

Prvo opsti model i prijave za cetiri vrste, zatim objasnjivo rangiranje, pa obavestenja i javni demo. Pilot prikazuje jedan kompletan tok: dopuna profila -> organizator objavi meetup -> relevantan korisnik dobije razlog i obavestenje -> prijavi se. Za grading dokumentovati stvarni problem otkrivanja dogadjaja, procenu korisnika da li su preporuke korisne, tehnicku obradu objava i monetizacionu hipotezu za organizatore.

Firebase cloud verifikacija ostaje zavisna od korisnikovog projekta i javne konfiguracije. Cloudflare Quick Tunnel daje javni preview dok origin i tunel rade; trajni hosting je zaseban deployment.
