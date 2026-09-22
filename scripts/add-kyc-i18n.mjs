/**
 * Ajoute les libellés propres à la vérification d'identité externe dans les
 * 15 langues réellement supportées. Idempotent : une clé déjà présente n'est
 * jamais écrasée.
 *
 * Usage : node scripts/add-kyc-i18n.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const T = {
  en: {
    kycTitle: "Identity verification",
    kycSubtitle:
      "A few details and your documents. Your progress is shown at the top of the page.",
    kycSubmit: "Finish verification",
    kycLinkTitle: "This verification link is not available",
    kycLinkInvalid: "This link is not valid. Please ask for a new one.",
    kycLinkExpired: "This link has expired. Please ask for a new one.",
    kycLinkRevoked: "This link has been cancelled. Please ask for a new one.",
    kycLinkUsed: "This verification has already been completed.",
    sTitle: "Verification completed",
    sSubtitle: "Thank you. Your identity details and documents have been received.",
    sNotice: "This link is now closed and cannot be used again.",
  },
  fr: {
    kycTitle: "Vérification d'identité",
    kycSubtitle:
      "Quelques informations et vos documents. Votre progression s'affiche en haut de page.",
    kycSubmit: "Terminer la vérification",
    kycLinkTitle: "Ce lien de vérification n'est pas disponible",
    kycLinkInvalid: "Ce lien n'est pas valide. Demandez-en un nouveau.",
    kycLinkExpired: "Ce lien a expiré. Demandez-en un nouveau.",
    kycLinkRevoked: "Ce lien a été annulé. Demandez-en un nouveau.",
    kycLinkUsed: "Cette vérification a déjà été effectuée.",
    sTitle: "Vérification terminée",
    sSubtitle: "Merci. Vos informations d'identité et vos documents ont bien été reçus.",
    sNotice: "Ce lien est désormais clos et ne peut plus être réutilisé.",
  },
  de: {
    kycTitle: "Identitätsprüfung",
    kycSubtitle:
      "Einige Angaben und Ihre Dokumente. Ihr Fortschritt wird oben angezeigt.",
    kycSubmit: "Prüfung abschließen",
    kycLinkTitle: "Dieser Prüflink ist nicht verfügbar",
    kycLinkInvalid: "Dieser Link ist ungültig. Bitte fordern Sie einen neuen an.",
    kycLinkExpired: "Dieser Link ist abgelaufen. Bitte fordern Sie einen neuen an.",
    kycLinkRevoked: "Dieser Link wurde storniert. Bitte fordern Sie einen neuen an.",
    kycLinkUsed: "Diese Prüfung wurde bereits abgeschlossen.",
    sTitle: "Prüfung abgeschlossen",
    sSubtitle: "Vielen Dank. Ihre Angaben und Dokumente sind eingegangen.",
    sNotice: "Dieser Link ist nun geschlossen und kann nicht erneut verwendet werden.",
  },
  es: {
    kycTitle: "Verificación de identidad",
    kycSubtitle:
      "Algunos datos y sus documentos. Su progreso aparece en la parte superior.",
    kycSubmit: "Finalizar la verificación",
    kycLinkTitle: "Este enlace de verificación no está disponible",
    kycLinkInvalid: "Este enlace no es válido. Solicite uno nuevo.",
    kycLinkExpired: "Este enlace ha caducado. Solicite uno nuevo.",
    kycLinkRevoked: "Este enlace ha sido anulado. Solicite uno nuevo.",
    kycLinkUsed: "Esta verificación ya se ha completado.",
    sTitle: "Verificación completada",
    sSubtitle: "Gracias. Hemos recibido sus datos de identidad y sus documentos.",
    sNotice: "Este enlace está cerrado y ya no puede utilizarse.",
  },
  it: {
    kycTitle: "Verifica dell'identità",
    kycSubtitle:
      "Alcune informazioni e i suoi documenti. L'avanzamento è indicato in alto.",
    kycSubmit: "Completa la verifica",
    kycLinkTitle: "Questo link di verifica non è disponibile",
    kycLinkInvalid: "Il link non è valido. Ne richieda uno nuovo.",
    kycLinkExpired: "Il link è scaduto. Ne richieda uno nuovo.",
    kycLinkRevoked: "Il link è stato annullato. Ne richieda uno nuovo.",
    kycLinkUsed: "Questa verifica è già stata completata.",
    sTitle: "Verifica completata",
    sSubtitle: "Grazie. I suoi dati e i suoi documenti sono stati ricevuti.",
    sNotice: "Questo link è ora chiuso e non può essere riutilizzato.",
  },
  nl: {
    kycTitle: "Identiteitsverificatie",
    kycSubtitle:
      "Enkele gegevens en uw documenten. Uw voortgang staat bovenaan de pagina.",
    kycSubmit: "Verificatie afronden",
    kycLinkTitle: "Deze verificatielink is niet beschikbaar",
    kycLinkInvalid: "Deze link is niet geldig. Vraag een nieuwe aan.",
    kycLinkExpired: "Deze link is verlopen. Vraag een nieuwe aan.",
    kycLinkRevoked: "Deze link is ingetrokken. Vraag een nieuwe aan.",
    kycLinkUsed: "Deze verificatie is al afgerond.",
    sTitle: "Verificatie afgerond",
    sSubtitle: "Bedankt. Uw gegevens en documenten zijn ontvangen.",
    sNotice: "Deze link is nu gesloten en kan niet opnieuw worden gebruikt.",
  },
  sl: {
    kycTitle: "Preverjanje istovetnosti",
    kycSubtitle: "Nekaj podatkov in vaši dokumenti. Napredek je prikazan zgoraj.",
    kycSubmit: "Zaključi preverjanje",
    kycLinkTitle: "Ta povezava za preverjanje ni na voljo",
    kycLinkInvalid: "Povezava ni veljavna. Prosite za novo.",
    kycLinkExpired: "Povezava je potekla. Prosite za novo.",
    kycLinkRevoked: "Povezava je bila preklicana. Prosite za novo.",
    kycLinkUsed: "To preverjanje je že zaključeno.",
    sTitle: "Preverjanje je zaključeno",
    sSubtitle: "Hvala. Vaše podatke in dokumente smo prejeli.",
    sNotice: "Povezava je zdaj zaprta in je ni več mogoče uporabiti.",
  },
  bg: {
    kycTitle: "Проверка на самоличността",
    kycSubtitle: "Няколко данни и вашите документи. Напредъкът е показан горе.",
    kycSubmit: "Завършване на проверката",
    kycLinkTitle: "Тази връзка за проверка не е достъпна",
    kycLinkInvalid: "Връзката е невалидна. Поискайте нова.",
    kycLinkExpired: "Връзката е изтекла. Поискайте нова.",
    kycLinkRevoked: "Връзката е анулирана. Поискайте нова.",
    kycLinkUsed: "Тази проверка вече е извършена.",
    sTitle: "Проверката е завършена",
    sSubtitle: "Благодарим. Получихме вашите данни и документи.",
    sNotice: "Връзката вече е затворена и не може да се използва отново.",
  },
  sk: {
    kycTitle: "Overenie totožnosti",
    kycSubtitle: "Niekoľko údajov a vaše dokumenty. Priebeh sa zobrazuje hore.",
    kycSubmit: "Dokončiť overenie",
    kycLinkTitle: "Tento overovací odkaz nie je dostupný",
    kycLinkInvalid: "Odkaz nie je platný. Požiadajte o nový.",
    kycLinkExpired: "Platnosť odkazu vypršala. Požiadajte o nový.",
    kycLinkRevoked: "Odkaz bol zrušený. Požiadajte o nový.",
    kycLinkUsed: "Toto overenie už bolo dokončené.",
    sTitle: "Overenie dokončené",
    sSubtitle: "Ďakujeme. Vaše údaje a dokumenty sme prijali.",
    sNotice: "Odkaz je uzavretý a nedá sa znova použiť.",
  },
  el: {
    kycTitle: "Επαλήθευση ταυτότητας",
    kycSubtitle: "Λίγα στοιχεία και τα έγγραφά σας. Η πρόοδος φαίνεται επάνω.",
    kycSubmit: "Ολοκλήρωση επαλήθευσης",
    kycLinkTitle: "Αυτός ο σύνδεσμος επαλήθευσης δεν είναι διαθέσιμος",
    kycLinkInvalid: "Ο σύνδεσμος δεν είναι έγκυρος. Ζητήστε νέον.",
    kycLinkExpired: "Ο σύνδεσμος έληξε. Ζητήστε νέον.",
    kycLinkRevoked: "Ο σύνδεσμος ακυρώθηκε. Ζητήστε νέον.",
    kycLinkUsed: "Η επαλήθευση έχει ήδη ολοκληρωθεί.",
    sTitle: "Η επαλήθευση ολοκληρώθηκε",
    sSubtitle: "Ευχαριστούμε. Τα στοιχεία και τα έγγραφά σας ελήφθησαν.",
    sNotice: "Ο σύνδεσμος έκλεισε και δεν μπορεί να χρησιμοποιηθεί ξανά.",
  },
  fi: {
    kycTitle: "Henkilöllisyyden vahvistus",
    kycSubtitle: "Muutama tieto ja asiakirjasi. Eteneminen näkyy sivun ylälaidassa.",
    kycSubmit: "Viimeistele vahvistus",
    kycLinkTitle: "Tämä vahvistuslinkki ei ole käytettävissä",
    kycLinkInvalid: "Linkki ei kelpaa. Pyydä uusi linkki.",
    kycLinkExpired: "Linkki on vanhentunut. Pyydä uusi linkki.",
    kycLinkRevoked: "Linkki on peruutettu. Pyydä uusi linkki.",
    kycLinkUsed: "Tämä vahvistus on jo tehty.",
    sTitle: "Vahvistus valmis",
    sSubtitle: "Kiitos. Tietosi ja asiakirjasi on vastaanotettu.",
    sNotice: "Linkki on nyt suljettu eikä sitä voi käyttää uudelleen.",
  },
  ro: {
    kycTitle: "Verificarea identității",
    kycSubtitle: "Câteva informații și documentele dvs. Progresul apare sus.",
    kycSubmit: "Finalizați verificarea",
    kycLinkTitle: "Acest link de verificare nu este disponibil",
    kycLinkInvalid: "Linkul nu este valid. Solicitați unul nou.",
    kycLinkExpired: "Linkul a expirat. Solicitați unul nou.",
    kycLinkRevoked: "Linkul a fost anulat. Solicitați unul nou.",
    kycLinkUsed: "Această verificare a fost deja finalizată.",
    sTitle: "Verificare finalizată",
    sSubtitle: "Vă mulțumim. Datele și documentele dvs. au fost primite.",
    sNotice: "Linkul este închis și nu mai poate fi folosit.",
  },
  pl: {
    kycTitle: "Weryfikacja tożsamości",
    kycSubtitle: "Kilka informacji i dokumenty. Postęp widoczny jest u góry strony.",
    kycSubmit: "Zakończ weryfikację",
    kycLinkTitle: "Ten link weryfikacyjny jest niedostępny",
    kycLinkInvalid: "Link jest nieprawidłowy. Poproś o nowy.",
    kycLinkExpired: "Link wygasł. Poproś o nowy.",
    kycLinkRevoked: "Link został anulowany. Poproś o nowy.",
    kycLinkUsed: "Ta weryfikacja została już zakończona.",
    sTitle: "Weryfikacja zakończona",
    sSubtitle: "Dziękujemy. Twoje dane i dokumenty zostały odebrane.",
    sNotice: "Link jest już zamknięty i nie można go użyć ponownie.",
  },
  hr: {
    kycTitle: "Provjera identiteta",
    kycSubtitle: "Nekoliko podataka i vaši dokumenti. Napredak je prikazan na vrhu.",
    kycSubmit: "Dovrši provjeru",
    kycLinkTitle: "Ova poveznica za provjeru nije dostupna",
    kycLinkInvalid: "Poveznica nije valjana. Zatražite novu.",
    kycLinkExpired: "Poveznica je istekla. Zatražite novu.",
    kycLinkRevoked: "Poveznica je poništena. Zatražite novu.",
    kycLinkUsed: "Ova je provjera već dovršena.",
    sTitle: "Provjera je dovršena",
    sSubtitle: "Hvala. Vaši podaci i dokumenti su zaprimljeni.",
    sNotice: "Poveznica je zatvorena i više se ne može upotrijebiti.",
  },
  hu: {
    kycTitle: "Személyazonosság ellenőrzése",
    kycSubtitle: "Néhány adat és a dokumentumai. A haladás az oldal tetején látható.",
    kycSubmit: "Ellenőrzés befejezése",
    kycLinkTitle: "Ez az ellenőrző hivatkozás nem érhető el",
    kycLinkInvalid: "A hivatkozás érvénytelen. Kérjen újat.",
    kycLinkExpired: "A hivatkozás lejárt. Kérjen újat.",
    kycLinkRevoked: "A hivatkozást visszavonták. Kérjen újat.",
    kycLinkUsed: "Ez az ellenőrzés már megtörtént.",
    sTitle: "Az ellenőrzés befejeződött",
    sSubtitle: "Köszönjük. Adatait és dokumentumait megkaptuk.",
    sNotice: "A hivatkozás lezárult, és nem használható újra.",
  },
};

let touched = 0;

for (const [lang, v] of Object.entries(T)) {
  const file = resolve("src/i18n/locales", `${lang}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));

  json.finance ??= {};
  json.finance.apply ??= {};
  json.finance.success ??= {};

  const apply = json.finance.apply;
  const success = json.finance.success;

  apply.kycTitle ??= v.kycTitle;
  apply.kycSubtitle ??= v.kycSubtitle;
  apply.kycSubmit ??= v.kycSubmit;
  apply.kycLinkTitle ??= v.kycLinkTitle;
  apply.kycLinkInvalid ??= v.kycLinkInvalid;
  apply.kycLinkExpired ??= v.kycLinkExpired;
  apply.kycLinkRevoked ??= v.kycLinkRevoked;
  apply.kycLinkUsed ??= v.kycLinkUsed;
  success.kycTitle ??= v.sTitle;
  success.kycSubtitle ??= v.sSubtitle;
  success.kycLinkNotice ??= v.sNotice;

  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  touched += 1;
}

console.log(`Libellés de vérification externe ajoutés dans ${touched} langues.`);
