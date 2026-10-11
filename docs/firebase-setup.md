# GEvents Firebase povezivanje

Kod podrzava dva eksplicitna rezima. `demo` radi lokalno sa fiktivnim profilima i deljenom datotekom. `firebase` koristi Google ili email/password naloge i Firestore, bez menjanja identiteta kroz demo kontrole. Cloud povezivanje nije provereno dok projekat ne bude dostupan. Novi tok registracije, raspored kolekcija i pregledan primer dataseta su opisani u [dataset/registration guide](firebase-dataset.md).

## 1. Firebase console

1. Kreirati ili izabrati Firebase projekat i registrovati Web app.
2. U Authentication -> Sign-in method ukljuciti Google i Email/Password providere. U Authorized domains dodati domen aplikacije; za lokalni test dodati localhost ako nedostaje.
3. Kreirati Cloud Firestore bazu. Objaviti pravila iz `firestore.rules`: direktan pristup browsera je zabranjen; sve komande idu kroz API. Korisnicka kolekcija je sada `gdevPilots/main/users`; odvojene kolekcije za vektore i aktivacija indeksa su u [users and vectors](firebase-vectors.md).
4. Iz Web app settings uzeti javne `apiKey`, `authDomain`, `projectId`, `appId`. Ova konfiguracija identifikuje projekat, nije Admin privatni kljuc.

## 2. Lokalni serverski env

Kopirati `.env.example` u `.env.server.local` i postaviti:

```dotenv
GEVENTS_BACKEND_MODE=firebase
GEVENTS_API_PORT=5181
GEVENTS_API_HOST=127.0.0.1
FIREBASE_PROJECT_ID=vas-stvarni-project-id
FIREBASE_WEB_API_KEY=javna-web-api-vrednost
FIREBASE_AUTH_DOMAIN=vas-stvarni-project-id.firebaseapp.com
FIREBASE_WEB_APP_ID=javna-web-app-id-vrednost
GEVENTS_ORGANIZER_UIDS=
```

Server koristi Application Default Credentials (ADC). Obican `gcloud auth application-default login` koristi gcloud OAuth client koji Firebase Authentication ne prihvata. Za lokalni razvoj kreirati sopstveni OAuth client tipa Desktop app i preuzeti njegov client configuration, zatim sa instaliranim Google Cloud CLI:

```powershell
gcloud auth application-default login --client-id-file="C:\putanja\desktop-oauth-client.json"
gcloud auth application-default set-quota-project VAS_PROJECT_ID
npm.cmd run dev
```

Nalog koji pokrece server mora imati pristup Firestore-u i potrebnu Firebase Auth privilegiju za proveru opozvanih tokena. Ne deliti service-account JSON u chatu i ne stavljati ga u `VITE_` promenljive. Ako se koristi datoteka kredencijala, drzati je van workspace-a i navesti je kroz serverski `GOOGLE_APPLICATION_CREDENTIALS`.

Na Google Cloud runtime-u koristiti service account identitet servisa i ADC bez preuzimanja privatnog kljuca. Firebase CLI prijava i prijava u Firebase Console ne predstavljaju same po sebi serverski ADC.

### Priprema za gdg-hackathon-d0b85

`.firebaserc` bira projekat `gdg-hackathon-d0b85`. Ignorisana `.env.firebase.local` sadrzi javni Web app config i port 5191; Firebase rezim nije aktiviran. Podesiti serverski ADC i proveriti Auth/Firestore pristup. Za ovaj env postoji eksplicitna komanda `npm.cmd run server:firebase`. Za zajednicki dev tok kopirati konfiguraciju u `.env.server.local` i ponovo pokrenuti API. Sam Web app config ne potvrdjuje pristup projektu ili integraciju. Import izvrsiti u praznom workspace-u pre prvog pravog naloga, prema dataset uputstvu.

## 3. Prvi organizator

1. Prijaviti se Google nalogom. API kreira profil vezan za provereni UID. Novi Firebase projekat pocinje bez fiktivnih ljudi ili dogadjaja.
2. U Firebase Authentication konzoli procitati UID tog naloga.
3. Dodati UID u `GEVENTS_ORGANIZER_UIDS` na serveru i ponovo pokrenuti server.
4. Otvoriti Organizer workspace i kreirati prvi dogadjaj. Za drugog korisnika koristiti drugi browser ili privatni prozor i drugi Google nalog.

Ova lista daje administratorski pristup celom pilotu. Pre rada sa vise nezavisnih organizacija treba uvesti vlasnistvo/uloge po organizaciji i dogadjaju.

## 4. Cloud Run priprema

`Dockerfile` gradi frontend, zatim Node server na Cloud Run `PORT` portu servira i `dist` i `/api`. `GEVENTS_API_HOST=0.0.0.0` je postavljen u image-u. Deploy nije izvrsen.

- U Cloud Run postaviti Firebase env vrednosti i organizatorske UID-eve, bez lokalnog `GEVENTS_API_PORT`.
- Dodeliti runtime service account-u potrebne Firestore/Auth IAM dozvole; koristiti identitet servisa umesto privatnog kljuca.
- Dopustiti javni pristup web aplikaciji; privatni API resursi i dalje zahtevaju validan Firebase token.
- Dodati stvarni Cloud Run/custom domen u Firebase Auth Authorized domains.
- Pokrenuti tok iz dva naloga pre objavljivanja kao spremnog pilota.

## 5. Obavezna cloud provera

- `/api/config` pokazuje `firebase`, a `/api/demo-session` vraca 404.
- Google ili email/password prijava kreira tacno jedan profil po UID-u; neuspesna API konekcija posle registracije nudi retry bez kreiranja drugog Auth naloga.
- Obican korisnik ne moze odobravati prijave ni menjati tudji profil, cak i uz rucno promenjen payload.
- Organizator kreira dogadjaj; drugi korisnik se prijavi; odobrenje se pojavi u njegovom browseru.
- Poziv, prihvatanje i status prijave ostaju odvojeni.
- Restart servera ne gubi podatke. Firestore transakcije cuvaju kapacitet pri konkurentnim zahtevima.

## Trenutna ogranicenja

- Korisnicka baza sada ima odvojena imena/prezimena, email iz verifikovanog tokena, kontakt i obrazovanje/radno iskustvo. Privatni PDF CV upload/download/delete zahteva `FIREBASE_STORAGE_BUCKET` i pristup tog server naloga privatnom bucket-u. Detalji: [user database](user-database.md).

- Firestore cuva profile u `users`, a dogadjaje, timove, prijave, pozive, obavestenja i veze u ostalim podkolekcijama `gdevPilots/main`. Schema 3 migrira stare `people` dokumente uz zadrzavanje prethodnih zapisa. Vektori su u odvojenim kolekcijama i ne ucitavaju se kroz polling. Stari JSON payload se konvertuje pri sledecem uspesnom upisu i cuva kao backup. Transakcije i dalje citaju ceo osnovni workspace, pa je ovo mali pilot; izmeriti kvote/performanse i ograniciti citanja pre rasta. Jedan upis/import podrzava najvise 450 promenjenih/obrisanih zapisa.
- UI osvezava stanje kroz API na oko dve sekunde; ne koristi direktne Firestore listenere.
- Lokalna datoteka podrzava jedan serverski proces. Za vise instanci koristiti Firestore.
- Nema CV obrade, algoritma, naplate, email poziva ni stvarnog LinkedIn/Kaggle importa.
- Firebase SDK/adapters se type-checkuju; stvarna Google prijava, IAM i cloud upisi zahtevaju stvarni projekat i odvojenu proveru.

Reference: https://firebase.google.com/docs/admin/setup, https://firebase.google.com/docs/auth/admin/verify-id-tokens, https://firebase.google.com/docs/firestore/manage-data/transactions.
