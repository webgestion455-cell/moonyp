#!/usr/bin/env bun
/**
 * Injection des 10 e-mails de cycle de vie manquants (vérification, analyse,
 * signature en attente, garantie signée, décaissement en préparation,
 * remboursement en cours, paiement reçu, retard, remboursé, annulé) dans les
 * 15 locales, chacune STRICTEMENT dans sa propre langue.
 *
 * Ajoute aussi le libellé de bouton `emails.cta.schedule`.
 *
 * Idempotent : relançable sans dupliquer ni écraser d'autres clés.
 * Exécution : `bun scripts/i18n-emails-lifecycle.mjs`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/i18n/locales";

/** Ordre des templates ; chaque langue fournit [subject, body, details]. */
const KEYS = [
  "applicationVerification",
  "applicationAnalysis",
  "signaturePending",
  "guaranteeSigned",
  "disbursementPreparing",
  "repaying",
  "repaymentReceived",
  "late",
  "repaid",
  "cancelled",
];

const L = {
  fr: {
    schedule: "Voir mon échéancier",
    t: [
      [
        "Dossier {{reference}} en vérification",
        "Bonjour {{firstName}}, votre dossier {{reference}} est en cours de vérification par nos équipes.",
        "Nous contrôlons l'authenticité et la lisibilité de vos pièces justificatives. Aucune action n'est requise de votre part à ce stade ; vous serez averti immédiatement si un document doit être complété.",
      ],
      [
        "Dossier {{reference}} en analyse",
        "Bonjour {{firstName}}, votre dossier {{reference}} est entré en phase d'analyse de solvabilité.",
        "Nos analystes étudient votre capacité de remboursement, la cohérence de vos revenus et le montant demandé. Le résultat de cette étude vous sera communiqué dès qu'il sera disponible dans votre espace sécurisé.",
      ],
      [
        "Signature en attente — dossier {{reference}}",
        "Bonjour {{firstName}}, votre contrat {{reference}} attend votre signature électronique.",
        "Tant que la signature n'est pas finalisée, le dossier reste en attente et les fonds ne peuvent pas être préparés. La signature s'effectue en ligne, avec un code à usage unique, en moins de deux minutes.",
      ],
      [
        "Couverture confirmée — dossier {{reference}}",
        "Bonjour {{firstName}}, la couverture du risque de crédit de votre dossier {{reference}} est confirmée.",
        "Cette étape validée, votre dossier poursuit son parcours vers l'assurance emprunteur puis la préparation du décaissement. Chaque étape reste consultable en temps réel dans votre espace sécurisé.",
      ],
      [
        "Décaissement en préparation — dossier {{reference}}",
        "Bonjour {{firstName}}, le décaissement de votre dossier {{reference}} est en préparation.",
        "Nos services financiers vérifient une dernière fois vos coordonnées bancaires avant l'émission du virement. Vous recevrez une confirmation dès que les fonds seront envoyés.",
      ],
      [
        "Remboursement en cours — dossier {{reference}}",
        "Bonjour {{firstName}}, votre dossier {{reference}} entre en phase de remboursement.",
        "Votre échéancier détaillé (capital, intérêts, solde restant dû) est disponible dans votre espace sécurisé. Chaque échéance encaissée y est enregistrée et vous est confirmée par email.",
      ],
      [
        "Paiement reçu — dossier {{reference}}",
        "Bonjour {{firstName}}, nous avons bien reçu votre paiement de {{amount}} pour votre dossier {{reference}}.",
        "L'échéance concernée est marquée comme réglée et votre solde restant dû est mis à jour dans votre espace sécurisé, où votre échéancier reste consultable et téléchargeable.",
      ],
      [
        "Échéance en retard — dossier {{reference}}",
        "Bonjour {{firstName}}, une échéance de votre dossier {{reference}} est en retard de paiement.",
        "Nous vous invitons à régulariser cette échéance dans les meilleurs délais afin d'éviter des frais de retard et un signalement. Si vous rencontrez une difficulté, contactez-nous : une solution d'aménagement peut être étudiée.",
      ],
      [
        "Dossier {{reference}} intégralement remboursé",
        "Bonjour {{firstName}}, votre dossier {{reference}} est intégralement remboursé. Nous vous remercions de votre confiance.",
        "Votre attestation de solde nul et l'historique complet de vos règlements restent disponibles dans votre espace sécurisé. Vous pouvez déposer une nouvelle demande à tout moment.",
      ],
      [
        "Dossier {{reference}} annulé",
        "Bonjour {{firstName}}, votre dossier {{reference}} a été annulé.",
        "Aucune somme ne vous sera prélevée au titre de ce dossier. Si cette annulation ne correspond pas à votre souhait, vous pouvez déposer une nouvelle demande depuis votre espace sécurisé.",
      ],
    ],
  },
  en: {
    schedule: "View my repayment schedule",
    t: [
      [
        "Application {{reference}} under verification",
        "Hello {{firstName}}, your application {{reference}} is currently being verified by our teams.",
        "We are checking the authenticity and legibility of your supporting documents. No action is required from you at this stage; you will be notified immediately if a document needs to be completed.",
      ],
      [
        "Application {{reference}} under analysis",
        "Hello {{firstName}}, your application {{reference}} has entered the credit analysis stage.",
        "Our analysts are reviewing your repayment capacity, the consistency of your income and the requested amount. The outcome will be shared with you as soon as it is available in your secure area.",
      ],
      [
        "Signature pending — file {{reference}}",
        "Hello {{firstName}}, your contract {{reference}} is awaiting your electronic signature.",
        "Until the signature is completed, the file remains on hold and funds cannot be prepared. Signing takes place online with a one-time code, in under two minutes.",
      ],
      [
        "Coverage confirmed — file {{reference}}",
        "Hello {{firstName}}, the credit risk coverage for your file {{reference}} is confirmed.",
        "With this step cleared, your file moves on to borrower insurance and then disbursement preparation. Every stage remains visible in real time in your secure area.",
      ],
      [
        "Disbursement in preparation — file {{reference}}",
        "Hello {{firstName}}, the disbursement of your file {{reference}} is being prepared.",
        "Our finance team is performing a final check of your bank details before issuing the transfer. You will receive a confirmation as soon as the funds are sent.",
      ],
      [
        "Repayment under way — file {{reference}}",
        "Hello {{firstName}}, your file {{reference}} is entering the repayment stage.",
        "Your detailed schedule (principal, interest, outstanding balance) is available in your secure area. Every instalment received is recorded there and confirmed to you by email.",
      ],
      [
        "Payment received — file {{reference}}",
        "Hello {{firstName}}, we have received your payment of {{amount}} for file {{reference}}.",
        "The relevant instalment is marked as settled and your outstanding balance is updated in your secure area, where your schedule remains available for download.",
      ],
      [
        "Instalment overdue — file {{reference}}",
        "Hello {{firstName}}, an instalment on your file {{reference}} is overdue.",
        "Please settle this instalment as soon as possible to avoid late fees and reporting. If you are facing difficulties, contact us: an arrangement can be considered.",
      ],
      [
        "File {{reference}} fully repaid",
        "Hello {{firstName}}, your file {{reference}} has been fully repaid. Thank you for your trust.",
        "Your zero-balance certificate and the full history of your payments remain available in your secure area. You may submit a new application at any time.",
      ],
      [
        "File {{reference}} cancelled",
        "Hello {{firstName}}, your file {{reference}} has been cancelled.",
        "No amount will be charged to you for this file. If this cancellation does not match your wishes, you can submit a new application from your secure area.",
      ],
    ],
  },
  de: {
    schedule: "Meinen Tilgungsplan ansehen",
    t: [
      [
        "Antrag {{reference}} in Prüfung",
        "Hallo {{firstName}}, Ihr Antrag {{reference}} wird derzeit von unseren Teams geprüft.",
        "Wir prüfen die Echtheit und Lesbarkeit Ihrer Nachweise. In dieser Phase ist von Ihnen nichts zu tun; wir melden uns sofort, wenn ein Dokument ergänzt werden muss.",
      ],
      [
        "Antrag {{reference}} in Analyse",
        "Hallo {{firstName}}, Ihr Antrag {{reference}} befindet sich in der Kreditanalyse.",
        "Unsere Analysten prüfen Ihre Rückzahlungsfähigkeit, die Plausibilität Ihrer Einkünfte und den beantragten Betrag. Das Ergebnis teilen wir Ihnen mit, sobald es in Ihrem sicheren Bereich vorliegt.",
      ],
      [
        "Unterschrift ausstehend — Akte {{reference}}",
        "Hallo {{firstName}}, Ihr Vertrag {{reference}} wartet auf Ihre elektronische Unterschrift.",
        "Solange die Unterschrift fehlt, bleibt die Akte offen und die Auszahlung kann nicht vorbereitet werden. Die Unterschrift erfolgt online mit einem Einmalcode in weniger als zwei Minuten.",
      ],
      [
        "Deckung bestätigt — Akte {{reference}}",
        "Hallo {{firstName}}, die Kreditrisikodeckung Ihrer Akte {{reference}} ist bestätigt.",
        "Damit geht Ihre Akte weiter zur Kreditversicherung und anschließend zur Vorbereitung der Auszahlung. Jeden Schritt sehen Sie in Echtzeit in Ihrem sicheren Bereich.",
      ],
      [
        "Auszahlung in Vorbereitung — Akte {{reference}}",
        "Hallo {{firstName}}, die Auszahlung Ihrer Akte {{reference}} wird vorbereitet.",
        "Unsere Finanzabteilung prüft Ihre Bankverbindung ein letztes Mal, bevor die Überweisung ausgeführt wird. Sie erhalten eine Bestätigung, sobald die Mittel versandt sind.",
      ],
      [
        "Rückzahlung läuft — Akte {{reference}}",
        "Hallo {{firstName}}, Ihre Akte {{reference}} tritt in die Rückzahlungsphase ein.",
        "Ihr detaillierter Tilgungsplan (Kapital, Zinsen, Restschuld) steht in Ihrem sicheren Bereich bereit. Jede eingegangene Rate wird dort erfasst und Ihnen per E-Mail bestätigt.",
      ],
      [
        "Zahlung erhalten — Akte {{reference}}",
        "Hallo {{firstName}}, wir haben Ihre Zahlung über {{amount}} für die Akte {{reference}} erhalten.",
        "Die betreffende Rate ist als beglichen markiert und Ihre Restschuld wurde in Ihrem sicheren Bereich aktualisiert, wo der Tilgungsplan jederzeit abrufbar bleibt.",
      ],
      [
        "Rate überfällig — Akte {{reference}}",
        "Hallo {{firstName}}, eine Rate Ihrer Akte {{reference}} ist überfällig.",
        "Bitte gleichen Sie diese Rate zeitnah aus, um Verzugskosten und eine Meldung zu vermeiden. Bei Schwierigkeiten sprechen Sie uns an: eine Anpassung kann geprüft werden.",
      ],
      [
        "Akte {{reference}} vollständig zurückgezahlt",
        "Hallo {{firstName}}, Ihre Akte {{reference}} ist vollständig zurückgezahlt. Vielen Dank für Ihr Vertrauen.",
        "Ihre Nullsaldo-Bescheinigung und die vollständige Zahlungshistorie bleiben in Ihrem sicheren Bereich verfügbar. Ein neuer Antrag ist jederzeit möglich.",
      ],
      [
        "Akte {{reference}} storniert",
        "Hallo {{firstName}}, Ihre Akte {{reference}} wurde storniert.",
        "Für diese Akte wird Ihnen kein Betrag berechnet. Falls die Storno nicht Ihrem Wunsch entspricht, können Sie in Ihrem sicheren Bereich einen neuen Antrag stellen.",
      ],
    ],
  },
  es: {
    schedule: "Ver mi cuadro de amortización",
    t: [
      [
        "Expediente {{reference}} en verificación",
        "Hola {{firstName}}, su expediente {{reference}} está siendo verificado por nuestros equipos.",
        "Comprobamos la autenticidad y la legibilidad de sus justificantes. En esta fase no debe hacer nada; le avisaremos de inmediato si falta completar algún documento.",
      ],
      [
        "Expediente {{reference}} en análisis",
        "Hola {{firstName}}, su expediente {{reference}} ha entrado en la fase de análisis de solvencia.",
        "Nuestros analistas estudian su capacidad de reembolso, la coherencia de sus ingresos y el importe solicitado. Le comunicaremos el resultado en cuanto esté disponible en su espacio seguro.",
      ],
      [
        "Firma pendiente — expediente {{reference}}",
        "Hola {{firstName}}, su contrato {{reference}} está pendiente de su firma electrónica.",
        "Mientras la firma no se complete, el expediente permanece en espera y los fondos no pueden prepararse. La firma se realiza en línea con un código de un solo uso en menos de dos minutos.",
      ],
      [
        "Cobertura confirmada — expediente {{reference}}",
        "Hola {{firstName}}, la cobertura del riesgo de crédito de su expediente {{reference}} está confirmada.",
        "Superada esta etapa, su expediente avanza hacia el seguro del prestatario y después a la preparación del desembolso. Puede seguir cada paso en tiempo real en su espacio seguro.",
      ],
      [
        "Desembolso en preparación — expediente {{reference}}",
        "Hola {{firstName}}, el desembolso de su expediente {{reference}} está en preparación.",
        "Nuestro departamento financiero verifica por última vez sus datos bancarios antes de emitir la transferencia. Recibirá una confirmación cuando se envíen los fondos.",
      ],
      [
        "Reembolso en curso — expediente {{reference}}",
        "Hola {{firstName}}, su expediente {{reference}} entra en la fase de reembolso.",
        "Su cuadro de amortización detallado (capital, intereses, saldo pendiente) está disponible en su espacio seguro. Cada cuota cobrada se registra allí y se le confirma por correo.",
      ],
      [
        "Pago recibido — expediente {{reference}}",
        "Hola {{firstName}}, hemos recibido su pago de {{amount}} correspondiente al expediente {{reference}}.",
        "La cuota afectada queda marcada como pagada y su saldo pendiente se actualiza en su espacio seguro, donde su cuadro de amortización sigue disponible para descargar.",
      ],
      [
        "Cuota vencida — expediente {{reference}}",
        "Hola {{firstName}}, una cuota de su expediente {{reference}} está impagada.",
        "Le pedimos regularizar esta cuota lo antes posible para evitar gastos de demora y su comunicación a los registros. Si tiene dificultades, contáctenos: podemos estudiar una solución.",
      ],
      [
        "Expediente {{reference}} reembolsado por completo",
        "Hola {{firstName}}, su expediente {{reference}} está reembolsado íntegramente. Gracias por su confianza.",
        "Su certificado de saldo cero y el historial completo de pagos permanecen disponibles en su espacio seguro. Puede presentar una nueva solicitud cuando lo desee.",
      ],
      [
        "Expediente {{reference}} anulado",
        "Hola {{firstName}}, su expediente {{reference}} ha sido anulado.",
        "No se le cobrará ningún importe por este expediente. Si esta anulación no corresponde a su voluntad, puede presentar una nueva solicitud desde su espacio seguro.",
      ],
    ],
  },
  it: {
    schedule: "Vedi il mio piano di ammortamento",
    t: [
      [
        "Pratica {{reference}} in verifica",
        "Ciao {{firstName}}, la tua pratica {{reference}} è in corso di verifica da parte dei nostri team.",
        "Verifichiamo l'autenticità e la leggibilità dei tuoi documenti. In questa fase non devi fare nulla; ti avviseremo subito se un documento dovrà essere integrato.",
      ],
      [
        "Pratica {{reference}} in analisi",
        "Ciao {{firstName}}, la tua pratica {{reference}} è entrata nella fase di analisi del merito creditizio.",
        "I nostri analisti valutano la tua capacità di rimborso, la coerenza dei redditi e l'importo richiesto. Ti comunicheremo l'esito appena sarà disponibile nella tua area sicura.",
      ],
      [
        "Firma in attesa — pratica {{reference}}",
        "Ciao {{firstName}}, il tuo contratto {{reference}} attende la tua firma elettronica.",
        "Fino alla firma la pratica resta sospesa e i fondi non possono essere predisposti. La firma avviene online con un codice monouso, in meno di due minuti.",
      ],
      [
        "Copertura confermata — pratica {{reference}}",
        "Ciao {{firstName}}, la copertura del rischio di credito della pratica {{reference}} è confermata.",
        "Superata questa fase, la pratica prosegue verso l'assicurazione del mutuatario e poi la preparazione dell'erogazione. Ogni passaggio è visibile in tempo reale nella tua area sicura.",
      ],
      [
        "Erogazione in preparazione — pratica {{reference}}",
        "Ciao {{firstName}}, l'erogazione della pratica {{reference}} è in preparazione.",
        "Il nostro ufficio finanziario effettua un ultimo controllo delle coordinate bancarie prima del bonifico. Riceverai una conferma appena i fondi saranno inviati.",
      ],
      [
        "Rimborso in corso — pratica {{reference}}",
        "Ciao {{firstName}}, la pratica {{reference}} entra nella fase di rimborso.",
        "Il piano di ammortamento dettagliato (capitale, interessi, debito residuo) è disponibile nella tua area sicura. Ogni rata incassata viene registrata e confermata via email.",
      ],
      [
        "Pagamento ricevuto — pratica {{reference}}",
        "Ciao {{firstName}}, abbiamo ricevuto il tuo pagamento di {{amount}} per la pratica {{reference}}.",
        "La rata interessata è contrassegnata come saldata e il debito residuo è aggiornato nella tua area sicura, dove il piano resta consultabile e scaricabile.",
      ],
      [
        "Rata scaduta — pratica {{reference}}",
        "Ciao {{firstName}}, una rata della pratica {{reference}} risulta insoluta.",
        "Ti invitiamo a regolarizzare la rata al più presto per evitare interessi di mora e segnalazioni. In caso di difficoltà contattaci: possiamo valutare una soluzione.",
      ],
      [
        "Pratica {{reference}} interamente rimborsata",
        "Ciao {{firstName}}, la pratica {{reference}} è interamente rimborsata. Grazie per la fiducia.",
        "L'attestazione di saldo zero e lo storico completo dei pagamenti restano disponibili nella tua area sicura. Puoi presentare una nuova richiesta quando vuoi.",
      ],
      [
        "Pratica {{reference}} annullata",
        "Ciao {{firstName}}, la pratica {{reference}} è stata annullata.",
        "Nessun importo ti sarà addebitato per questa pratica. Se l'annullamento non corrisponde alla tua volontà, puoi presentare una nuova richiesta dalla tua area sicura.",
      ],
    ],
  },
  nl: {
    schedule: "Mijn aflossingsschema bekijken",
    t: [
      [
        "Dossier {{reference}} in verificatie",
        "Hallo {{firstName}}, uw dossier {{reference}} wordt momenteel door onze teams gecontroleerd.",
        "Wij controleren de echtheid en leesbaarheid van uw bewijsstukken. U hoeft nu niets te doen; wij laten het direct weten als een document moet worden aangevuld.",
      ],
      [
        "Dossier {{reference}} in analyse",
        "Hallo {{firstName}}, uw dossier {{reference}} is in de kredietanalyse gekomen.",
        "Onze analisten beoordelen uw aflossingscapaciteit, de consistentie van uw inkomen en het gevraagde bedrag. Zodra de uitkomst beschikbaar is, ziet u die in uw beveiligde omgeving.",
      ],
      [
        "Ondertekening in afwachting — dossier {{reference}}",
        "Hallo {{firstName}}, uw contract {{reference}} wacht op uw elektronische ondertekening.",
        "Zolang de ondertekening niet is afgerond, blijft het dossier in afwachting en kunnen de middelen niet worden klaargezet. Ondertekenen gebeurt online met een eenmalige code, in minder dan twee minuten.",
      ],
      [
        "Dekking bevestigd — dossier {{reference}}",
        "Hallo {{firstName}}, de dekking van het kredietrisico voor dossier {{reference}} is bevestigd.",
        "Na deze stap gaat uw dossier verder naar de kredietverzekering en daarna naar de voorbereiding van de uitbetaling. Elke stap volgt u live in uw beveiligde omgeving.",
      ],
      [
        "Uitbetaling in voorbereiding — dossier {{reference}}",
        "Hallo {{firstName}}, de uitbetaling van dossier {{reference}} wordt voorbereid.",
        "Onze financiële afdeling controleert uw bankgegevens een laatste keer voordat de overboeking wordt uitgevoerd. U ontvangt een bevestiging zodra de middelen zijn verzonden.",
      ],
      [
        "Aflossing gestart — dossier {{reference}}",
        "Hallo {{firstName}}, uw dossier {{reference}} gaat de aflossingsfase in.",
        "Uw gedetailleerde aflossingsschema (hoofdsom, rente, restschuld) staat in uw beveiligde omgeving. Elke ontvangen termijn wordt daar vastgelegd en per e-mail bevestigd.",
      ],
      [
        "Betaling ontvangen — dossier {{reference}}",
        "Hallo {{firstName}}, wij hebben uw betaling van {{amount}} voor dossier {{reference}} ontvangen.",
        "De betreffende termijn staat als betaald en uw restschuld is bijgewerkt in uw beveiligde omgeving, waar uw schema beschikbaar blijft om te downloaden.",
      ],
      [
        "Termijn achterstallig — dossier {{reference}}",
        "Hallo {{firstName}}, een termijn van dossier {{reference}} is niet betaald.",
        "Betaal deze termijn zo snel mogelijk om achterstandskosten en registratie te voorkomen. Heeft u moeilijkheden? Neem contact met ons op: een regeling is bespreekbaar.",
      ],
      [
        "Dossier {{reference}} volledig afgelost",
        "Hallo {{firstName}}, uw dossier {{reference}} is volledig afgelost. Bedankt voor uw vertrouwen.",
        "Uw verklaring van nulstand en de volledige betalingshistorie blijven beschikbaar in uw beveiligde omgeving. U kunt altijd een nieuwe aanvraag indienen.",
      ],
      [
        "Dossier {{reference}} geannuleerd",
        "Hallo {{firstName}}, uw dossier {{reference}} is geannuleerd.",
        "Voor dit dossier wordt niets in rekening gebracht. Als deze annulering niet uw bedoeling is, kunt u een nieuwe aanvraag indienen in uw beveiligde omgeving.",
      ],
    ],
  },
  pl: {
    schedule: "Zobacz harmonogram spłat",
    t: [
      [
        "Wniosek {{reference}} w weryfikacji",
        "Witaj {{firstName}}, Twój wniosek {{reference}} jest obecnie weryfikowany przez nasze zespoły.",
        "Sprawdzamy autentyczność i czytelność Twoich dokumentów. Na tym etapie nie musisz nic robić; poinformujemy Cię natychmiast, jeśli któryś dokument trzeba będzie uzupełnić.",
      ],
      [
        "Wniosek {{reference}} w analizie",
        "Witaj {{firstName}}, Twój wniosek {{reference}} wszedł w etap analizy zdolności kredytowej.",
        "Nasi analitycy badają Twoją zdolność spłaty, spójność dochodów oraz wnioskowaną kwotę. Wynik przekażemy, gdy tylko pojawi się w Twojej bezpiecznej strefie.",
      ],
      [
        "Oczekiwanie na podpis — wniosek {{reference}}",
        "Witaj {{firstName}}, Twoja umowa {{reference}} czeka na podpis elektroniczny.",
        "Dopóki podpis nie zostanie złożony, wniosek pozostaje wstrzymany, a środki nie mogą zostać przygotowane. Podpis składasz online jednorazowym kodem, w niecałe dwie minuty.",
      ],
      [
        "Zabezpieczenie potwierdzone — wniosek {{reference}}",
        "Witaj {{firstName}}, zabezpieczenie ryzyka kredytowego wniosku {{reference}} zostało potwierdzone.",
        "Po tym etapie wniosek przechodzi do ubezpieczenia kredytobiorcy, a następnie do przygotowania wypłaty. Każdy krok widzisz na bieżąco w bezpiecznej strefie.",
      ],
      [
        "Wypłata w przygotowaniu — wniosek {{reference}}",
        "Witaj {{firstName}}, wypłata środków dla wniosku {{reference}} jest przygotowywana.",
        "Nasz dział finansowy sprawdza ostatni raz Twoje dane bankowe przed zleceniem przelewu. Potwierdzenie otrzymasz, gdy środki zostaną wysłane.",
      ],
      [
        "Spłata w toku — wniosek {{reference}}",
        "Witaj {{firstName}}, Twój wniosek {{reference}} wchodzi w fazę spłaty.",
        "Szczegółowy harmonogram (kapitał, odsetki, saldo pozostałe) znajdziesz w bezpiecznej strefie. Każda zaksięgowana rata jest tam zapisywana i potwierdzana e-mailem.",
      ],
      [
        "Płatność otrzymana — wniosek {{reference}}",
        "Witaj {{firstName}}, otrzymaliśmy Twoją płatność {{amount}} dotyczącą wniosku {{reference}}.",
        "Odpowiednia rata została oznaczona jako zapłacona, a saldo pozostałe zaktualizowane w bezpiecznej strefie, gdzie harmonogram pozostaje dostępny do pobrania.",
      ],
      [
        "Rata przeterminowana — wniosek {{reference}}",
        "Witaj {{firstName}}, rata Twojego wniosku {{reference}} jest niezapłacona.",
        "Prosimy o uregulowanie raty jak najszybciej, aby uniknąć kosztów opóźnienia i zgłoszenia. W razie trudności skontaktuj się z nami — możemy rozważyć rozwiązanie.",
      ],
      [
        "Wniosek {{reference}} spłacony w całości",
        "Witaj {{firstName}}, Twój wniosek {{reference}} został spłacony w całości. Dziękujemy za zaufanie.",
        "Zaświadczenie o zerowym saldzie i pełna historia płatności pozostają w Twojej bezpiecznej strefie. Nowy wniosek możesz złożyć w każdej chwili.",
      ],
      [
        "Wniosek {{reference}} anulowany",
        "Witaj {{firstName}}, Twój wniosek {{reference}} został anulowany.",
        "Za ten wniosek nie zostanie pobrana żadna kwota. Jeśli anulowanie nie jest zgodne z Twoją wolą, możesz złożyć nowy wniosek w bezpiecznej strefie.",
      ],
    ],
  },
  ro: {
    schedule: "Vezi graficul meu de rambursare",
    t: [
      [
        "Dosarul {{reference}} în verificare",
        "Bună {{firstName}}, dosarul dumneavoastră {{reference}} este în curs de verificare de către echipele noastre.",
        "Verificăm autenticitatea și lizibilitatea documentelor. În această etapă nu trebuie să faceți nimic; vă anunțăm imediat dacă un document trebuie completat.",
      ],
      [
        "Dosarul {{reference}} în analiză",
        "Bună {{firstName}}, dosarul {{reference}} a intrat în etapa de analiză a solvabilității.",
        "Analiștii noștri examinează capacitatea de rambursare, coerența veniturilor și suma solicitată. Rezultatul vă va fi comunicat imediat ce este disponibil în spațiul securizat.",
      ],
      [
        "Semnătură în așteptare — dosar {{reference}}",
        "Bună {{firstName}}, contractul {{reference}} așteaptă semnătura dumneavoastră electronică.",
        "Până la semnare, dosarul rămâne în așteptare și fondurile nu pot fi pregătite. Semnarea se face online, cu un cod unic, în mai puțin de două minute.",
      ],
      [
        "Acoperire confirmată — dosar {{reference}}",
        "Bună {{firstName}}, acoperirea riscului de credit pentru dosarul {{reference}} este confirmată.",
        "După această etapă, dosarul continuă către asigurarea de credit și apoi pregătirea plății. Fiecare etapă este vizibilă în timp real în spațiul securizat.",
      ],
      [
        "Plată în pregătire — dosar {{reference}}",
        "Bună {{firstName}}, plata fondurilor pentru dosarul {{reference}} este în pregătire.",
        "Departamentul financiar verifică o ultimă dată datele bancare înainte de emiterea transferului. Veți primi o confirmare imediat după trimiterea fondurilor.",
      ],
      [
        "Rambursare în curs — dosar {{reference}}",
        "Bună {{firstName}}, dosarul {{reference}} intră în etapa de rambursare.",
        "Graficul detaliat (principal, dobândă, sold rămas) este disponibil în spațiul securizat. Fiecare rată încasată este înregistrată acolo și confirmată prin email.",
      ],
      [
        "Plată primită — dosar {{reference}}",
        "Bună {{firstName}}, am primit plata de {{amount}} pentru dosarul {{reference}}.",
        "Rata vizată este marcată ca achitată, iar soldul rămas este actualizat în spațiul securizat, unde graficul rămâne disponibil pentru descărcare.",
      ],
      [
        "Rată restantă — dosar {{reference}}",
        "Bună {{firstName}}, o rată a dosarului {{reference}} este restantă.",
        "Vă rugăm să achitați rata cât mai repede pentru a evita penalitățile de întârziere și raportarea. Dacă întâmpinați dificultăți, contactați-ne: putem analiza o soluție.",
      ],
      [
        "Dosarul {{reference}} rambursat integral",
        "Bună {{firstName}}, dosarul {{reference}} este rambursat integral. Vă mulțumim pentru încredere.",
        "Adeverința de sold zero și istoricul complet al plăților rămân în spațiul securizat. Puteți depune o nouă cerere oricând.",
      ],
      [
        "Dosarul {{reference}} anulat",
        "Bună {{firstName}}, dosarul {{reference}} a fost anulat.",
        "Nu vi se va percepe nicio sumă pentru acest dosar. Dacă anularea nu corespunde dorinței dumneavoastră, puteți depune o nouă cerere din spațiul securizat.",
      ],
    ],
  },
  el: {
    schedule: "Δείτε το πρόγραμμα αποπληρωμής μου",
    t: [
      [
        "Αίτηση {{reference}} σε έλεγχο",
        "Γεια σας {{firstName}}, η αίτησή σας {{reference}} ελέγχεται από τις ομάδες μας.",
        "Ελέγχουμε τη γνησιότητα και την αναγνωσιμότητα των δικαιολογητικών σας. Σε αυτό το στάδιο δεν απαιτείται ενέργεια από εσάς· θα ενημερωθείτε αμέσως αν χρειαστεί συμπλήρωση εγγράφου.",
      ],
      [
        "Αίτηση {{reference}} σε ανάλυση",
        "Γεια σας {{firstName}}, η αίτησή σας {{reference}} πέρασε στο στάδιο πιστωτικής ανάλυσης.",
        "Οι αναλυτές μας εξετάζουν την ικανότητα αποπληρωμής, τη συνέπεια των εισοδημάτων και το αιτούμενο ποσό. Το αποτέλεσμα θα εμφανιστεί στον ασφαλή χώρο σας μόλις είναι διαθέσιμο.",
      ],
      [
        "Εκκρεμεί υπογραφή — αίτηση {{reference}}",
        "Γεια σας {{firstName}}, το συμβόλαιό σας {{reference}} αναμένει την ηλεκτρονική υπογραφή σας.",
        "Έως την υπογραφή, ο φάκελος παραμένει σε αναμονή και τα κεφάλαια δεν μπορούν να προετοιμαστούν. Η υπογραφή γίνεται διαδικτυακά με μοναδικό κωδικό, σε λιγότερο από δύο λεπτά.",
      ],
      [
        "Επιβεβαιωμένη κάλυψη — αίτηση {{reference}}",
        "Γεια σας {{firstName}}, η κάλυψη πιστωτικού κινδύνου για την αίτηση {{reference}} επιβεβαιώθηκε.",
        "Μετά το στάδιο αυτό, ο φάκελος προχωρά στην ασφάλιση δανειολήπτη και έπειτα στην προετοιμασία της εκταμίευσης. Κάθε βήμα είναι ορατό σε πραγματικό χρόνο στον ασφαλή χώρο σας.",
      ],
      [
        "Εκταμίευση σε προετοιμασία — αίτηση {{reference}}",
        "Γεια σας {{firstName}}, η εκταμίευση της αίτησης {{reference}} προετοιμάζεται.",
        "Το χρηματοοικονομικό τμήμα ελέγχει για τελευταία φορά τα τραπεζικά σας στοιχεία πριν την έμβασμα. Θα λάβετε επιβεβαίωση μόλις αποσταλούν τα κεφάλαια.",
      ],
      [
        "Αποπληρωμή σε εξέλιξη — αίτηση {{reference}}",
        "Γεια σας {{firstName}}, η αίτησή σας {{reference}} εισέρχεται στη φάση αποπληρωμής.",
        "Το αναλυτικό πρόγραμμα (κεφάλαιο, τόκοι, υπόλοιπο) είναι διαθέσιμο στον ασφαλή χώρο σας. Κάθε δόση που εισπράττεται καταγράφεται εκεί και επιβεβαιώνεται με email.",
      ],
      [
        "Πληρωμή ελήφθη — αίτηση {{reference}}",
        "Γεια σας {{firstName}}, λάβαμε την πληρωμή σας {{amount}} για την αίτηση {{reference}}.",
        "Η σχετική δόση σημειώνεται ως εξοφλημένη και το υπόλοιπό σας ενημερώθηκε στον ασφαλή χώρο σας, όπου το πρόγραμμα παραμένει διαθέσιμο για λήψη.",
      ],
      [
        "Ληξιπρόθεσμη δόση — αίτηση {{reference}}",
        "Γεια σας {{firstName}}, μια δόση της αίτησης {{reference}} είναι ληξιπρόθεσμη.",
        "Παρακαλούμε εξοφλήστε τη δόση το συντομότερο, για να αποφύγετε τόκους υπερημερίας και αναφορά. Αν αντιμετωπίζετε δυσκολία, επικοινωνήστε μαζί μας: μπορεί να εξεταστεί ρύθμιση.",
      ],
      [
        "Αίτηση {{reference}} πλήρως εξοφλημένη",
        "Γεια σας {{firstName}}, η αίτησή σας {{reference}} εξοφλήθηκε πλήρως. Σας ευχαριστούμε για την εμπιστοσύνη σας.",
        "Η βεβαίωση μηδενικού υπολοίπου και το πλήρες ιστορικό πληρωμών παραμένουν στον ασφαλή χώρο σας. Μπορείτε να υποβάλετε νέα αίτηση οποτεδήποτε.",
      ],
      [
        "Αίτηση {{reference}} ακυρώθηκε",
        "Γεια σας {{firstName}}, η αίτησή σας {{reference}} ακυρώθηκε.",
        "Δεν θα σας χρεωθεί κανένα ποσό για τον φάκελο αυτό. Αν η ακύρωση δεν αντιστοιχεί στην επιθυμία σας, μπορείτε να υποβάλετε νέα αίτηση από τον ασφαλή χώρο σας.",
      ],
    ],
  },
  bg: {
    schedule: "Виж погасителния ми план",
    t: [
      [
        "Досие {{reference}} в проверка",
        "Здравейте {{firstName}}, вашето досие {{reference}} се проверява от нашите екипи.",
        "Проверяваме автентичността и четливостта на документите ви. На този етап не е нужно да правите нищо; ще ви уведомим веднага, ако е необходимо допълване на документ.",
      ],
      [
        "Досие {{reference}} в анализ",
        "Здравейте {{firstName}}, вашето досие {{reference}} влезе в етап на кредитен анализ.",
        "Нашите анализатори преценяват капацитета ви за погасяване, съответствието на доходите и заявената сума. Резултатът ще се появи в защитената ви зона веднага след готовност.",
      ],
      [
        "Очаква се подпис — досие {{reference}}",
        "Здравейте {{firstName}}, вашият договор {{reference}} очаква електронния ви подпис.",
        "До подписването досието остава в изчакване и средствата не могат да бъдат подготвени. Подписването е онлайн с еднократен код и отнема под две минути.",
      ],
      [
        "Потвърдено покритие — досие {{reference}}",
        "Здравейте {{firstName}}, покритието на кредитния риск по досие {{reference}} е потвърдено.",
        "След този етап досието продължава към застраховката на кредитополучателя и след това към подготовката на усвояването. Всяка стъпка е видима в реално време в защитената ви зона.",
      ],
      [
        "Усвояване в подготовка — досие {{reference}}",
        "Здравейте {{firstName}}, усвояването по досие {{reference}} се подготвя.",
        "Финансовият ни отдел проверява последно банковите ви данни преди нареждането на превода. Ще получите потвърждение веднага след изпращане на средствата.",
      ],
      [
        "Погасяване в ход — досие {{reference}}",
        "Здравейте {{firstName}}, вашето досие {{reference}} влиза във фаза на погасяване.",
        "Подробният погасителен план (главница, лихви, остатък) е достъпен в защитената ви зона. Всяка постъпила вноска се записва там и се потвърждава по имейл.",
      ],
      [
        "Получено плащане — досие {{reference}}",
        "Здравейте {{firstName}}, получихме плащането ви от {{amount}} по досие {{reference}}.",
        "Съответната вноска е отбелязана като платена, а остатъкът е актуализиран в защитената ви зона, където планът остава достъпен за изтегляне.",
      ],
      [
        "Просрочена вноска — досие {{reference}}",
        "Здравейте {{firstName}}, вноска по досие {{reference}} е просрочена.",
        "Молим да погасите вноската възможно най-скоро, за да избегнете разходи за забава и уведомяване. При затруднение се свържете с нас: възможно е разсрочване.",
      ],
      [
        "Досие {{reference}} изцяло погасено",
        "Здравейте {{firstName}}, вашето досие {{reference}} е изцяло погасено. Благодарим за доверието.",
        "Удостоверението за нулев остатък и цялата история на плащанията остават в защитената ви зона. Можете да подадете ново заявление по всяко време.",
      ],
      [
        "Досие {{reference}} анулирано",
        "Здравейте {{firstName}}, вашето досие {{reference}} беше анулирано.",
        "Няма да ви бъде начислена сума по това досие. Ако анулирането не отговаря на желанието ви, можете да подадете ново заявление от защитената си зона.",
      ],
    ],
  },
  fi: {
    schedule: "Katso maksusuunnitelmani",
    t: [
      [
        "Hakemus {{reference}} tarkistuksessa",
        "Hei {{firstName}}, hakemustasi {{reference}} tarkistetaan tiimeissämme.",
        "Tarkistamme liitteidesi aitouden ja luettavuuden. Tässä vaiheessa sinun ei tarvitse tehdä mitään; ilmoitamme heti, jos asiakirjaa on täydennettävä.",
      ],
      [
        "Hakemus {{reference}} analyysissä",
        "Hei {{firstName}}, hakemuksesi {{reference}} on siirtynyt luottoanalyysiin.",
        "Analyytikkomme arvioivat takaisinmaksukykyäsi, tulojesi johdonmukaisuutta ja haettua summaa. Tulos näkyy turvallisessa tilassasi heti, kun se on valmis.",
      ],
      [
        "Allekirjoitus odottaa — hakemus {{reference}}",
        "Hei {{firstName}}, sopimuksesi {{reference}} odottaa sähköistä allekirjoitustasi.",
        "Ennen allekirjoitusta hakemus odottaa eikä varoja voi valmistella. Allekirjoitus tehdään verkossa kertakäyttöisellä koodilla alle kahdessa minuutissa.",
      ],
      [
        "Kattavuus vahvistettu — hakemus {{reference}}",
        "Hei {{firstName}}, hakemuksen {{reference}} luottoriskin kattavuus on vahvistettu.",
        "Tämän jälkeen hakemus siirtyy lainaturvavakuutukseen ja sitten maksatuksen valmisteluun. Jokainen vaihe näkyy reaaliajassa turvallisessa tilassasi.",
      ],
      [
        "Maksatus valmistelussa — hakemus {{reference}}",
        "Hei {{firstName}}, hakemuksen {{reference}} maksatusta valmistellaan.",
        "Rahoitusosastomme tarkistaa pankkitietosi viimeisen kerran ennen tilisiirtoa. Saat vahvistuksen heti, kun varat on lähetetty.",
      ],
      [
        "Takaisinmaksu käynnissä — hakemus {{reference}}",
        "Hei {{firstName}}, hakemuksesi {{reference}} siirtyy takaisinmaksuvaiheeseen.",
        "Yksityiskohtainen maksusuunnitelma (pääoma, korot, jäljellä oleva velka) on turvallisessa tilassasi. Jokainen vastaanotettu erä kirjataan sinne ja vahvistetaan sähköpostilla.",
      ],
      [
        "Maksu vastaanotettu — hakemus {{reference}}",
        "Hei {{firstName}}, olemme vastaanottaneet {{amount}} maksusi hakemukseen {{reference}}.",
        "Kyseinen erä on merkitty maksetuksi ja jäljellä oleva velka päivitetty turvalliseen tilaasi, jossa maksusuunnitelma on ladattavissa.",
      ],
      [
        "Erä myöhässä — hakemus {{reference}}",
        "Hei {{firstName}}, hakemuksesi {{reference}} erä on maksamatta.",
        "Pyydämme maksamaan erän mahdollisimman pian viivästyskulujen ja merkinnän välttämiseksi. Jos sinulla on vaikeuksia, ota yhteyttä: järjestelyä voidaan harkita.",
      ],
      [
        "Hakemus {{reference}} maksettu kokonaan",
        "Hei {{firstName}}, hakemuksesi {{reference}} on maksettu kokonaan. Kiitos luottamuksestasi.",
        "Todistus nollasaldosta ja koko maksuhistoria pysyvät turvallisessa tilassasi. Voit tehdä uuden hakemuksen milloin tahansa.",
      ],
      [
        "Hakemus {{reference}} peruutettu",
        "Hei {{firstName}}, hakemuksesi {{reference}} on peruutettu.",
        "Tästä hakemuksesta ei veloiteta mitään. Jos peruutus ei vastaa toivettasi, voit tehdä uuden hakemuksen turvallisessa tilassasi.",
      ],
    ],
  },
  hr: {
    schedule: "Pogledaj moj plan otplate",
    t: [
      [
        "Predmet {{reference}} u provjeri",
        "Pozdrav {{firstName}}, vaš predmet {{reference}} trenutno provjeravaju naši timovi.",
        "Provjeravamo vjerodostojnost i čitljivost vaših dokumenata. U ovoj fazi ne morate ništa učiniti; obavijestit ćemo vas odmah ako dokument treba dopuniti.",
      ],
      [
        "Predmet {{reference}} u analizi",
        "Pozdrav {{firstName}}, vaš predmet {{reference}} ušao je u fazu kreditne analize.",
        "Naši analitičari procjenjuju vašu sposobnost otplate, dosljednost prihoda i traženi iznos. Rezultat ćete vidjeti u sigurnom prostoru odmah po dovršetku.",
      ],
      [
        "Potpis u očekivanju — predmet {{reference}}",
        "Pozdrav {{firstName}}, vaš ugovor {{reference}} čeka vaš elektronički potpis.",
        "Do potpisa predmet ostaje na čekanju i sredstva se ne mogu pripremiti. Potpisivanje je online, jednokratnim kodom, u manje od dvije minute.",
      ],
      [
        "Pokriće potvrđeno — predmet {{reference}}",
        "Pozdrav {{firstName}}, pokriće kreditnog rizika za predmet {{reference}} je potvrđeno.",
        "Nakon ove faze predmet ide na osiguranje korisnika kredita, a zatim na pripremu isplate. Svaki korak vidljiv je u stvarnom vremenu u sigurnom prostoru.",
      ],
      [
        "Isplata u pripremi — predmet {{reference}}",
        "Pozdrav {{firstName}}, isplata sredstava za predmet {{reference}} je u pripremi.",
        "Naša financijska služba posljednji put provjerava vaše bankovne podatke prije naloga za plaćanje. Potvrdu ćete dobiti odmah nakon slanja sredstava.",
      ],
      [
        "Otplata u tijeku — predmet {{reference}}",
        "Pozdrav {{firstName}}, vaš predmet {{reference}} ulazi u fazu otplate.",
        "Detaljan plan otplate (glavnica, kamate, preostali dug) dostupan je u sigurnom prostoru. Svaka primljena rata bilježi se tamo i potvrđuje e-poštom.",
      ],
      [
        "Plaćanje primljeno — predmet {{reference}}",
        "Pozdrav {{firstName}}, primili smo vaše plaćanje od {{amount}} za predmet {{reference}}.",
        "Odgovarajuća rata označena je kao plaćena, a preostali dug ažuriran je u sigurnom prostoru, gdje plan ostaje dostupan za preuzimanje.",
      ],
      [
        "Rata u dospijeću — predmet {{reference}}",
        "Pozdrav {{firstName}}, rata vašeg predmeta {{reference}} nije plaćena.",
        "Molimo podmirite ratu što prije kako biste izbjegli zatezne troškove i prijavu. Ako imate poteškoća, obratite nam se: moguće je dogovoriti rješenje.",
      ],
      [
        "Predmet {{reference}} u cijelosti otplaćen",
        "Pozdrav {{firstName}}, vaš predmet {{reference}} u cijelosti je otplaćen. Hvala na povjerenju.",
        "Potvrda o nultom saldu i cijela povijest plaćanja ostaju u sigurnom prostoru. Novi zahtjev možete podnijeti u svakom trenutku.",
      ],
      [
        "Predmet {{reference}} otkazan",
        "Pozdrav {{firstName}}, vaš predmet {{reference}} je otkazan.",
        "Za ovaj predmet nećete biti ništa naplaćeni. Ako otkazivanje ne odgovara vašoj želji, možete podnijeti novi zahtjev iz sigurnog prostora.",
      ],
    ],
  },
  hu: {
    schedule: "Törlesztési tervem megtekintése",
    t: [
      [
        "{{reference}} ügylet ellenőrzés alatt",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügyletét jelenleg csapataink ellenőrzik.",
        "Ellenőrizzük igazolásai eredetiségét és olvashatóságát. Ebben a szakaszban nincs tennivalója; azonnal jelezzük, ha egy dokumentumot pótolni kell.",
      ],
      [
        "{{reference}} ügylet elemzés alatt",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylete hitelelemzési szakaszba került.",
        "Elemzőink vizsgálják törlesztési képességét, jövedelmének összhangját és az igényelt összeget. Az eredmény a biztonságos felületén jelenik meg, amint elkészül.",
      ],
      [
        "Aláírásra vár — {{reference}} ügylet",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} szerződése az elektronikus aláírására vár.",
        "Az aláírásig az ügylet várakozik, és az összeg nem készíthető elő. Az aláírás online, egyszeri kóddal, két percen belül elvégezhető.",
      ],
      [
        "Fedezet megerősítve — {{reference}} ügylet",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylet hitelkockázati fedezete megerősítve.",
        "Ezt követően az ügylet a hitelfedezeti biztosításra, majd a kifizetés előkészítésére lép. Minden szakaszt valós időben követhet a biztonságos felületén.",
      ],
      [
        "Kifizetés előkészítés alatt — {{reference}} ügylet",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylet kifizetése előkészítés alatt áll.",
        "Pénzügyi osztályunk utolsó alkalommal ellenőrzi bankszámlaadatait az átutalás előtt. Az összeg elküldéséről visszaigazolást kap.",
      ],
      [
        "Törlesztés folyamatban — {{reference}} ügylet",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylete törlesztési szakaszba lép.",
        "Részletes törlesztési terve (tőke, kamat, fennálló tartozás) a biztonságos felületén érhető el. Minden beérkezett részletet rögzítünk és e-mailben visszaigazolunk.",
      ],
      [
        "Fizetés beérkezett — {{reference}} ügylet",
        "Üdvözöljük {{firstName}}, megérkezett {{amount}} összegű fizetése a(z) {{reference}} ügylethez.",
        "Az érintett részlet rendezettként szerepel, fennálló tartozása pedig frissült a biztonságos felületén, ahol a törlesztési terv letölthető marad.",
      ],
      [
        "Késedelmes részlet — {{reference}} ügylet",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylet egy részlete késedelmes.",
        "Kérjük, rendezze a részletet mielőbb, hogy elkerülje a késedelmi költségeket és a bejelentést. Nehézség esetén keressen minket: megoldás egyeztethető.",
      ],
      [
        "{{reference}} ügylet teljesen visszafizetve",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylete teljes egészében visszafizetésre került. Köszönjük a bizalmát.",
        "A nulla egyenlegről szóló igazolás és a teljes fizetési előzmény a biztonságos felületén marad. Új kérelmet bármikor beadhat.",
      ],
      [
        "{{reference}} ügylet törölve",
        "Üdvözöljük {{firstName}}, a(z) {{reference}} ügylete törölve lett.",
        "Ezért az ügyletért semmilyen összeget nem számolunk fel. Ha a törlés nem az Ön szándéka, a biztonságos felületén új kérelmet indíthat.",
      ],
    ],
  },
  sk: {
    schedule: "Zobraziť môj splátkový kalendár",
    t: [
      [
        "Žiadosť {{reference}} v overovaní",
        "Dobrý deň {{firstName}}, vašu žiadosť {{reference}} práve overujú naše tímy.",
        "Kontrolujeme pravosť a čitateľnosť vašich dokladov. V tejto fáze nemusíte nič robiť; okamžite vás upozorníme, ak bude potrebné doplniť dokument.",
      ],
      [
        "Žiadosť {{reference}} v analýze",
        "Dobrý deň {{firstName}}, vaša žiadosť {{reference}} vstúpila do fázy úverovej analýzy.",
        "Naši analytici posudzujú vašu schopnosť splácať, súlad príjmov a požadovanú sumu. Výsledok uvidíte vo svojej bezpečnej zóne, len čo bude k dispozícii.",
      ],
      [
        "Čaká sa na podpis — žiadosť {{reference}}",
        "Dobrý deň {{firstName}}, vaša zmluva {{reference}} čaká na váš elektronický podpis.",
        "Do podpisu zostáva žiadosť pozastavená a prostriedky nemožno pripraviť. Podpis prebieha online jednorazovým kódom do dvoch minút.",
      ],
      [
        "Krytie potvrdené — žiadosť {{reference}}",
        "Dobrý deň {{firstName}}, krytie úverového rizika žiadosti {{reference}} je potvrdené.",
        "Po tejto fáze žiadosť pokračuje k poisteniu dlžníka a potom k príprave vyplatenia. Každý krok vidíte v reálnom čase vo svojej bezpečnej zóne.",
      ],
      [
        "Vyplatenie v príprave — žiadosť {{reference}}",
        "Dobrý deň {{firstName}}, vyplatenie prostriedkov k žiadosti {{reference}} sa pripravuje.",
        "Naše finančné oddelenie naposledy kontroluje vaše bankové údaje pred zadaním prevodu. Potvrdenie dostanete hneď po odoslaní prostriedkov.",
      ],
      [
        "Splácanie prebieha — žiadosť {{reference}}",
        "Dobrý deň {{firstName}}, vaša žiadosť {{reference}} vstupuje do fázy splácania.",
        "Podrobný splátkový kalendár (istina, úroky, zostatok) je vo vašej bezpečnej zóne. Každá prijatá splátka sa tam zaznamená a potvrdíme ju e-mailom.",
      ],
      [
        "Platba prijatá — žiadosť {{reference}}",
        "Dobrý deň {{firstName}}, prijali sme vašu platbu {{amount}} k žiadosti {{reference}}.",
        "Príslušná splátka je označená ako uhradená a zostatok bol aktualizovaný vo vašej bezpečnej zóne, kde kalendár zostáva na stiahnutie.",
      ],
      [
        "Splátka po termíne — žiadosť {{reference}}",
        "Dobrý deň {{firstName}}, splátka vašej žiadosti {{reference}} je po termíne.",
        "Prosíme o úhradu splátky čo najskôr, aby ste sa vyhli nákladom z omeškania a nahláseniu. Pri ťažkostiach nás kontaktujte: riešenie je možné dohodnúť.",
      ],
      [
        "Žiadosť {{reference}} úplne splatená",
        "Dobrý deň {{firstName}}, vaša žiadosť {{reference}} je úplne splatená. Ďakujeme za dôveru.",
        "Potvrdenie o nulovom zostatku a celú históriu platieb nájdete vo svojej bezpečnej zóne. Novú žiadosť môžete podať kedykoľvek.",
      ],
      [
        "Žiadosť {{reference}} zrušená",
        "Dobrý deň {{firstName}}, vaša žiadosť {{reference}} bola zrušená.",
        "Za túto žiadosť vám nebude nič účtované. Ak zrušenie nezodpovedá vášmu želaniu, môžete podať novú žiadosť vo svojej bezpečnej zóne.",
      ],
    ],
  },
  sl: {
    schedule: "Ogled mojega načrta odplačil",
    t: [
      [
        "Zadeva {{reference}} v preverjanju",
        "Pozdravljeni {{firstName}}, vašo zadevo {{reference}} trenutno preverjajo naše ekipe.",
        "Preverjamo pristnost in berljivost vaših dokazil. V tej fazi vam ni treba storiti ničesar; takoj vas obvestimo, če bo treba dokument dopolniti.",
      ],
      [
        "Zadeva {{reference}} v analizi",
        "Pozdravljeni {{firstName}}, vaša zadeva {{reference}} je vstopila v fazo kreditne analize.",
        "Naši analitiki presojajo vašo zmožnost odplačevanja, skladnost dohodkov in zaprošeni znesek. Izid boste videli v varnem prostoru, takoj ko bo pripravljen.",
      ],
      [
        "Podpis v pričakovanju — zadeva {{reference}}",
        "Pozdravljeni {{firstName}}, vaša pogodba {{reference}} čaka na vaš elektronski podpis.",
        "Do podpisa zadeva ostaja v čakanju in sredstev ni mogoče pripraviti. Podpis poteka spletno z enkratno kodo, v manj kot dveh minutah.",
      ],
      [
        "Kritje potrjeno — zadeva {{reference}}",
        "Pozdravljeni {{firstName}}, kritje kreditnega tveganja za zadevo {{reference}} je potrjeno.",
        "Po tej fazi zadeva nadaljuje k zavarovanju kreditojemalca in nato k pripravi izplačila. Vsak korak spremljate v realnem času v varnem prostoru.",
      ],
      [
        "Izplačilo v pripravi — zadeva {{reference}}",
        "Pozdravljeni {{firstName}}, izplačilo sredstev za zadevo {{reference}} se pripravlja.",
        "Naša finančna služba še zadnjič preveri vaše bančne podatke pred izvedbo nakazila. Potrditev prejmete takoj po pošiljanju sredstev.",
      ],
      [
        "Odplačevanje poteka — zadeva {{reference}}",
        "Pozdravljeni {{firstName}}, vaša zadeva {{reference}} vstopa v fazo odplačevanja.",
        "Podroben načrt odplačil (glavnica, obresti, preostali dolg) je na voljo v varnem prostoru. Vsak prejeti obrok se tam zabeleži in potrdi po e-pošti.",
      ],
      [
        "Plačilo prejeto — zadeva {{reference}}",
        "Pozdravljeni {{firstName}}, prejeli smo vaše plačilo {{amount}} za zadevo {{reference}}.",
        "Zadevni obrok je označen kot poravnan, preostali dolg pa posodobljen v varnem prostoru, kjer načrt ostaja na voljo za prenos.",
      ],
      [
        "Zapadli obrok — zadeva {{reference}}",
        "Pozdravljeni {{firstName}}, obrok vaše zadeve {{reference}} je zapadel neplačan.",
        "Prosimo, obrok poravnajte čim prej, da se izognete zamudnim stroškom in prijavi. Ob težavah nas kontaktirajte: rešitev je mogoče dogovoriti.",
      ],
      [
        "Zadeva {{reference}} v celoti odplačana",
        "Pozdravljeni {{firstName}}, vaša zadeva {{reference}} je v celoti odplačana. Hvala za zaupanje.",
        "Potrdilo o ničelnem stanju in celotna zgodovina plačil ostaneta v varnem prostoru. Novo prošnjo lahko oddate kadar koli.",
      ],
      [
        "Zadeva {{reference}} preklicana",
        "Pozdravljeni {{firstName}}, vaša zadeva {{reference}} je bila preklicana.",
        "Za to zadevo vam ne bo obračunan noben znesek. Če preklic ne ustreza vaši želji, lahko v varnem prostoru oddate novo prošnjo.",
      ],
    ],
  },
};

let touched = 0;
for (const [lang, pack] of Object.entries(L)) {
  const file = join(DIR, `${lang}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.emails ??= {};
  json.emails.cta ??= {};
  json.emails.cta.schedule = pack.schedule;
  KEYS.forEach((key, i) => {
    const [subject, body, details] = pack.t[i];
    json.emails[key] = { subject, body, details };
  });
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  touched++;
}
console.log(`✓ ${KEYS.length} e-mails de cycle de vie injectés dans ${touched} locales`);
