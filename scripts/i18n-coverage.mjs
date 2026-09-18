/**
 * Injection des libellés « assurance emprunteur » (interface client sécurisée)
 * et des nouveaux emails transactionnels d'assurance dans les 15 locales.
 *
 * Clés ajoutées :
 *   finance.insurance.*            → écran de choix du client (portail sécurisé)
 *   emails.insurancePayNow         → le client règle immédiatement
 *   emails.insurancePayLater       → paiement programmé à une date choisie
 *   emails.insuranceDeclined       → renonciation à l'assurance
 *   emails.insurancePaymentValidated → encaissement validé par un administrateur
 *   emails.insuranceReminder       → rappel d'échéance (tâche planifiée)
 *
 * Idempotent : relançable, n'écrase jamais une traduction déjà présente.
 * Usage : node scripts/i18n-coverage.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DIR = "src/i18n/locales";

/** @type {Record<string, {emails: Record<string, {subject:string, body:string, details:string}>, insurance: Record<string, unknown>}>} */
const T = {
  fr: {
    emails: {
      insurancePayNow: {
        subject: "Assurance — paiement immédiat · dossier {{reference}}",
        body: "Bonjour {{firstName}}, vous avez choisi de régler immédiatement les frais d'assurance de {{amount}}.",
        details:
          "Les instructions de paiement (bénéficiaire, IBAN, BIC et référence à rappeler) sont disponibles dans votre espace sécurisé. Le paiement n'est réputé reçu qu'après validation par nos équipes.",
      },
      insurancePayLater: {
        subject: "Assurance — paiement programmé · dossier {{reference}}",
        body: "Bonjour {{firstName}}, votre paiement de {{amount}} est programmé le {{date}}.",
        details:
          "Votre dossier reste réservé jusqu'à la date choisie. Vous pouvez avancer le paiement à tout moment depuis votre espace sécurisé ; des rappels vous seront adressés avant l'échéance.",
      },
      insuranceDeclined: {
        subject: "Assurance — renonciation enregistrée · dossier {{reference}}",
        body: "Bonjour {{firstName}}, nous avons enregistré votre renonciation à l'assurance emprunteur.",
        details:
          "Sans assurance, la poursuite du dossier peut être réexaminée par notre comité. Vous pouvez revenir sur ce choix depuis votre espace sécurisé tant que le financement n'est pas débloqué.",
      },
      insurancePaymentValidated: {
        subject: "Assurance — paiement validé · dossier {{reference}}",
        body: "Bonjour {{firstName}}, nous confirmons la réception des frais d'assurance.",
        details:
          "Votre couverture est en cours de mise en place. L'attestation et le numéro de police seront disponibles dans votre espace sécurisé dès validation de la police.",
      },
      insuranceReminder: {
        subject: "Rappel — frais d'assurance · dossier {{reference}}",
        body: "Bonjour {{firstName}}, votre paiement de {{amount}} est attendu le {{date}}.",
        details:
          "Ce rappel automatique vous est adressé avant l'échéance que vous avez choisie. Retrouvez les instructions de paiement dans votre espace sécurisé.",
      },
    },
    insurance: {
      fee: "Frais de mise en place de l'assurance",
      paymentStatus: "Statut du paiement",
      payment: {
        unpaid: "Non payé",
        not_required: "Sans frais",
        pending: "En attente",
        awaiting_payment: "En attente de paiement",
        paid: "Payé",
        waived: "Renoncé",
        failed: "Échec",
      },
      dueDate: "Échéance de paiement",
      scheduledDate: "Date de paiement programmée",
      paidNotice: "Vos frais d'assurance ont été validés par nos équipes.",
      chosen: {
        pay_now: "Vous avez choisi de payer immédiatement.",
        decline: "Vous avez renoncé à l'assurance.",
        pay_later: "Vous avez choisi de payer ultérieurement.",
      },
      instructions: "Instructions de paiement",
      validationNotice: "Un paiement n'est réputé reçu qu'après validation par nos équipes.",
      question: "Souhaitez-vous régler les frais d'assurance ?",
      options: {
        pay_now: "Oui, payer maintenant",
        decline: "Non, renoncer à l'assurance",
        pay_later: "Oui, payer plus tard",
      },
      optionsHint: {
        pay_now: "Vous recevrez les instructions de paiement.",
        decline: "Votre dossier sera réexaminé sans assurance.",
        pay_later: "Choisissez une date : des rappels vous seront envoyés.",
      },
      pickDate: "Date de paiement souhaitée",
      confirmChoice: "Confirmer mon choix",
      noPaymentNotice:
        "Ce choix n'emporte aucun paiement : il n'est confirmé qu'après validation par nos équipes.",
      choiceSaved: "Choix enregistré",
      error: {
        dateRequired: "Veuillez choisir une date de paiement.",
        datePast: "La date choisie est déjà passée.",
        generic: "Action impossible.",
      },
    },
  },

  en: {
    emails: {
      insurancePayNow: {
        subject: "Insurance — immediate payment · file {{reference}}",
        body: "Hello {{firstName}}, you chose to pay the insurance fee of {{amount}} now.",
        details:
          "Payment instructions (beneficiary, IBAN, BIC and reference) are available in your secure area. A payment is only considered received once validated by our team.",
      },
      insurancePayLater: {
        subject: "Insurance — payment scheduled · file {{reference}}",
        body: "Hello {{firstName}}, your payment of {{amount}} is scheduled for {{date}}.",
        details:
          "Your file stays reserved until the chosen date. You may pay earlier at any time from your secure area; reminders will be sent before the due date.",
      },
      insuranceDeclined: {
        subject: "Insurance — waiver recorded · file {{reference}}",
        body: "Hello {{firstName}}, we recorded your decision to waive borrower insurance.",
        details:
          "Without insurance, your file may be reviewed again by our committee. You can change this choice from your secure area as long as funds have not been released.",
      },
      insurancePaymentValidated: {
        subject: "Insurance — payment validated · file {{reference}}",
        body: "Hello {{firstName}}, we confirm receipt of your insurance fee.",
        details:
          "Your cover is being set up. The certificate and policy number will appear in your secure area once the policy is validated.",
      },
      insuranceReminder: {
        subject: "Reminder — insurance fee · file {{reference}}",
        body: "Hello {{firstName}}, your payment of {{amount}} is due on {{date}}.",
        details:
          "This automatic reminder is sent before the date you chose. Payment instructions are available in your secure area.",
      },
    },
    insurance: {
      fee: "Insurance set-up fee",
      paymentStatus: "Payment status",
      payment: {
        unpaid: "Unpaid",
        not_required: "No fee",
        pending: "Pending",
        awaiting_payment: "Awaiting payment",
        paid: "Paid",
        waived: "Waived",
        failed: "Failed",
      },
      dueDate: "Payment due date",
      scheduledDate: "Scheduled payment date",
      paidNotice: "Your insurance fee has been validated by our team.",
      chosen: {
        pay_now: "You chose to pay now.",
        decline: "You waived the insurance.",
        pay_later: "You chose to pay later.",
      },
      instructions: "Payment instructions",
      validationNotice: "A payment is only considered received once validated by our team.",
      question: "Would you like to pay the insurance fee?",
      options: {
        pay_now: "Yes, pay now",
        decline: "No, waive the insurance",
        pay_later: "Yes, pay later",
      },
      optionsHint: {
        pay_now: "You will receive payment instructions.",
        decline: "Your file will be reviewed without insurance.",
        pay_later: "Pick a date: reminders will be sent.",
      },
      pickDate: "Preferred payment date",
      confirmChoice: "Confirm my choice",
      noPaymentNotice:
        "This choice does not make any payment: it is confirmed only after validation by our team.",
      choiceSaved: "Choice saved",
      error: {
        dateRequired: "Please choose a payment date.",
        datePast: "The chosen date is already in the past.",
        generic: "Action not possible.",
      },
    },
  },

  de: {
    emails: {
      insurancePayNow: {
        subject: "Versicherung — sofortige Zahlung · Akte {{reference}}",
        body: "Guten Tag {{firstName}}, Sie zahlen die Versicherungsgebühr von {{amount}} sofort.",
        details:
          "Die Zahlungsanweisungen (Empfänger, IBAN, BIC und Referenz) finden Sie in Ihrem sicheren Bereich. Eine Zahlung gilt erst nach Prüfung durch unser Team als eingegangen.",
      },
      insurancePayLater: {
        subject: "Versicherung — Zahlung geplant · Akte {{reference}}",
        body: "Guten Tag {{firstName}}, Ihre Zahlung von {{amount}} ist für den {{date}} geplant.",
        details:
          "Ihre Akte bleibt bis zum gewählten Datum reserviert. Sie können jederzeit früher zahlen; vor dem Fälligkeitstag erhalten Sie Erinnerungen.",
      },
      insuranceDeclined: {
        subject: "Versicherung — Verzicht erfasst · Akte {{reference}}",
        body: "Guten Tag {{firstName}}, wir haben Ihren Verzicht auf die Restkreditversicherung erfasst.",
        details:
          "Ohne Versicherung kann Ihre Akte erneut geprüft werden. Solange die Auszahlung nicht erfolgt ist, können Sie Ihre Wahl im sicheren Bereich ändern.",
      },
      insurancePaymentValidated: {
        subject: "Versicherung — Zahlung bestätigt · Akte {{reference}}",
        body: "Guten Tag {{firstName}}, wir bestätigen den Eingang Ihrer Versicherungsgebühr.",
        details:
          "Ihr Versicherungsschutz wird eingerichtet. Bescheinigung und Policennummer erscheinen nach Validierung im sicheren Bereich.",
      },
      insuranceReminder: {
        subject: "Erinnerung — Versicherungsgebühr · Akte {{reference}}",
        body: "Guten Tag {{firstName}}, Ihre Zahlung von {{amount}} ist am {{date}} fällig.",
        details:
          "Diese automatische Erinnerung wird vor dem von Ihnen gewählten Datum gesendet. Die Zahlungsanweisungen finden Sie im sicheren Bereich.",
      },
    },
    insurance: {
      fee: "Einrichtungsgebühr der Versicherung",
      paymentStatus: "Zahlungsstatus",
      payment: {
        unpaid: "Nicht bezahlt",
        not_required: "Ohne Gebühr",
        pending: "Ausstehend",
        awaiting_payment: "Zahlung ausstehend",
        paid: "Bezahlt",
        waived: "Verzichtet",
        failed: "Fehlgeschlagen",
      },
      dueDate: "Fälligkeitsdatum",
      scheduledDate: "Geplantes Zahlungsdatum",
      paidNotice: "Ihre Versicherungsgebühr wurde von unserem Team bestätigt.",
      chosen: {
        pay_now: "Sie zahlen sofort.",
        decline: "Sie haben auf die Versicherung verzichtet.",
        pay_later: "Sie zahlen später.",
      },
      instructions: "Zahlungsanweisungen",
      validationNotice: "Eine Zahlung gilt erst nach Prüfung durch unser Team als eingegangen.",
      question: "Möchten Sie die Versicherungsgebühr bezahlen?",
      options: {
        pay_now: "Ja, jetzt bezahlen",
        decline: "Nein, auf die Versicherung verzichten",
        pay_later: "Ja, später bezahlen",
      },
      optionsHint: {
        pay_now: "Sie erhalten die Zahlungsanweisungen.",
        decline: "Ihre Akte wird ohne Versicherung geprüft.",
        pay_later: "Datum wählen: Sie erhalten Erinnerungen.",
      },
      pickDate: "Gewünschtes Zahlungsdatum",
      confirmChoice: "Auswahl bestätigen",
      noPaymentNotice:
        "Diese Auswahl löst keine Zahlung aus: Sie gilt erst nach Bestätigung durch unser Team.",
      choiceSaved: "Auswahl gespeichert",
      error: {
        dateRequired: "Bitte wählen Sie ein Zahlungsdatum.",
        datePast: "Das gewählte Datum liegt in der Vergangenheit.",
        generic: "Aktion nicht möglich.",
      },
    },
  },

  es: {
    emails: {
      insurancePayNow: {
        subject: "Seguro — pago inmediato · expediente {{reference}}",
        body: "Hola {{firstName}}, ha elegido pagar ahora los gastos de seguro de {{amount}}.",
        details:
          "Las instrucciones de pago (beneficiario, IBAN, BIC y referencia) están en su espacio seguro. Un pago solo se considera recibido tras la validación de nuestro equipo.",
      },
      insurancePayLater: {
        subject: "Seguro — pago programado · expediente {{reference}}",
        body: "Hola {{firstName}}, su pago de {{amount}} está previsto para el {{date}}.",
        details:
          "Su expediente queda reservado hasta la fecha elegida. Puede adelantar el pago en cualquier momento; recibirá recordatorios antes del vencimiento.",
      },
      insuranceDeclined: {
        subject: "Seguro — renuncia registrada · expediente {{reference}}",
        body: "Hola {{firstName}}, hemos registrado su renuncia al seguro de prestatario.",
        details:
          "Sin seguro, su expediente puede volver a ser examinado por nuestro comité. Puede cambiar esta decisión mientras no se hayan liberado los fondos.",
      },
      insurancePaymentValidated: {
        subject: "Seguro — pago validado · expediente {{reference}}",
        body: "Hola {{firstName}}, confirmamos la recepción de los gastos de seguro.",
        details:
          "Su cobertura se está activando. El certificado y el número de póliza estarán disponibles en su espacio seguro tras la validación.",
      },
      insuranceReminder: {
        subject: "Recordatorio — gastos de seguro · expediente {{reference}}",
        body: "Hola {{firstName}}, su pago de {{amount}} vence el {{date}}.",
        details:
          "Este recordatorio automático se envía antes de la fecha que eligió. Encontrará las instrucciones de pago en su espacio seguro.",
      },
    },
    insurance: {
      fee: "Gastos de contratación del seguro",
      paymentStatus: "Estado del pago",
      payment: {
        unpaid: "No pagado",
        not_required: "Sin gastos",
        pending: "Pendiente",
        awaiting_payment: "Pendiente de pago",
        paid: "Pagado",
        waived: "Renunciado",
        failed: "Fallido",
      },
      dueDate: "Fecha de vencimiento",
      scheduledDate: "Fecha de pago programada",
      paidNotice: "Sus gastos de seguro han sido validados por nuestro equipo.",
      chosen: {
        pay_now: "Ha elegido pagar ahora.",
        decline: "Ha renunciado al seguro.",
        pay_later: "Ha elegido pagar más tarde.",
      },
      instructions: "Instrucciones de pago",
      validationNotice: "Un pago solo se considera recibido tras la validación de nuestro equipo.",
      question: "¿Desea pagar los gastos de seguro?",
      options: {
        pay_now: "Sí, pagar ahora",
        decline: "No, renunciar al seguro",
        pay_later: "Sí, pagar más tarde",
      },
      optionsHint: {
        pay_now: "Recibirá las instrucciones de pago.",
        decline: "Su expediente se revisará sin seguro.",
        pay_later: "Elija una fecha: recibirá recordatorios.",
      },
      pickDate: "Fecha de pago deseada",
      confirmChoice: "Confirmar mi elección",
      noPaymentNotice:
        "Esta elección no realiza ningún pago: se confirma solo tras la validación de nuestro equipo.",
      choiceSaved: "Elección guardada",
      error: {
        dateRequired: "Elija una fecha de pago.",
        datePast: "La fecha elegida ya ha pasado.",
        generic: "Acción imposible.",
      },
    },
  },

  it: {
    emails: {
      insurancePayNow: {
        subject: "Assicurazione — pagamento immediato · pratica {{reference}}",
        body: "Buongiorno {{firstName}}, ha scelto di pagare subito le spese assicurative di {{amount}}.",
        details:
          "Le istruzioni di pagamento (beneficiario, IBAN, BIC e riferimento) sono disponibili nella sua area sicura. Il pagamento risulta ricevuto solo dopo la convalida del nostro team.",
      },
      insurancePayLater: {
        subject: "Assicurazione — pagamento programmato · pratica {{reference}}",
        body: "Buongiorno {{firstName}}, il pagamento di {{amount}} è previsto per il {{date}}.",
        details:
          "La pratica resta riservata fino alla data scelta. Può anticipare il pagamento in qualsiasi momento; riceverà promemoria prima della scadenza.",
      },
      insuranceDeclined: {
        subject: "Assicurazione — rinuncia registrata · pratica {{reference}}",
        body: "Buongiorno {{firstName}}, abbiamo registrato la sua rinuncia all'assicurazione.",
        details:
          "Senza assicurazione la pratica può essere riesaminata dal nostro comitato. Può modificare la scelta finché i fondi non sono erogati.",
      },
      insurancePaymentValidated: {
        subject: "Assicurazione — pagamento convalidato · pratica {{reference}}",
        body: "Buongiorno {{firstName}}, confermiamo la ricezione delle spese assicurative.",
        details:
          "La copertura è in fase di attivazione. Certificato e numero di polizza saranno disponibili nella sua area sicura dopo la convalida.",
      },
      insuranceReminder: {
        subject: "Promemoria — spese assicurative · pratica {{reference}}",
        body: "Buongiorno {{firstName}}, il pagamento di {{amount}} scade il {{date}}.",
        details:
          "Questo promemoria automatico precede la data da lei scelta. Le istruzioni di pagamento sono nella sua area sicura.",
      },
    },
    insurance: {
      fee: "Spese di attivazione dell'assicurazione",
      paymentStatus: "Stato del pagamento",
      payment: {
        unpaid: "Non pagato",
        not_required: "Senza spese",
        pending: "In attesa",
        awaiting_payment: "In attesa di pagamento",
        paid: "Pagato",
        waived: "Rinunciato",
        failed: "Fallito",
      },
      dueDate: "Data di scadenza",
      scheduledDate: "Data di pagamento programmata",
      paidNotice: "Le spese assicurative sono state convalidate dal nostro team.",
      chosen: {
        pay_now: "Ha scelto di pagare subito.",
        decline: "Ha rinunciato all'assicurazione.",
        pay_later: "Ha scelto di pagare più tardi.",
      },
      instructions: "Istruzioni di pagamento",
      validationNotice: "Un pagamento risulta ricevuto solo dopo la convalida del nostro team.",
      question: "Desidera pagare le spese assicurative?",
      options: {
        pay_now: "Sì, pagare subito",
        decline: "No, rinunciare all'assicurazione",
        pay_later: "Sì, pagare più tardi",
      },
      optionsHint: {
        pay_now: "Riceverà le istruzioni di pagamento.",
        decline: "La pratica sarà riesaminata senza assicurazione.",
        pay_later: "Scelga una data: riceverà promemoria.",
      },
      pickDate: "Data di pagamento desiderata",
      confirmChoice: "Confermo la mia scelta",
      noPaymentNotice:
        "Questa scelta non comporta alcun pagamento: è confermata solo dopo la convalida del nostro team.",
      choiceSaved: "Scelta registrata",
      error: {
        dateRequired: "Scelga una data di pagamento.",
        datePast: "La data scelta è già passata.",
        generic: "Azione non possibile.",
      },
    },
  },

  nl: {
    emails: {
      insurancePayNow: {
        subject: "Verzekering — directe betaling · dossier {{reference}}",
        body: "Hallo {{firstName}}, u betaalt de verzekeringskosten van {{amount}} nu.",
        details:
          "De betaalinstructies (begunstigde, IBAN, BIC en referentie) staan in uw beveiligde omgeving. Een betaling geldt pas als ontvangen na validatie door ons team.",
      },
      insurancePayLater: {
        subject: "Verzekering — betaling gepland · dossier {{reference}}",
        body: "Hallo {{firstName}}, uw betaling van {{amount}} staat gepland op {{date}}.",
        details:
          "Uw dossier blijft gereserveerd tot de gekozen datum. U kunt eerder betalen; u ontvangt herinneringen vóór de vervaldatum.",
      },
      insuranceDeclined: {
        subject: "Verzekering — afstand geregistreerd · dossier {{reference}}",
        body: "Hallo {{firstName}}, wij hebben uw afstand van de verzekering geregistreerd.",
        details:
          "Zonder verzekering kan uw dossier opnieuw worden beoordeeld. Zolang de fondsen niet zijn vrijgegeven, kunt u uw keuze wijzigen.",
      },
      insurancePaymentValidated: {
        subject: "Verzekering — betaling gevalideerd · dossier {{reference}}",
        body: "Hallo {{firstName}}, wij bevestigen de ontvangst van de verzekeringskosten.",
        details:
          "Uw dekking wordt opgestart. Het certificaat en polisnummer verschijnen na validatie in uw beveiligde omgeving.",
      },
      insuranceReminder: {
        subject: "Herinnering — verzekeringskosten · dossier {{reference}}",
        body: "Hallo {{firstName}}, uw betaling van {{amount}} vervalt op {{date}}.",
        details:
          "Deze automatische herinnering wordt vóór de door u gekozen datum verstuurd. De betaalinstructies staan in uw beveiligde omgeving.",
      },
    },
    insurance: {
      fee: "Opstartkosten van de verzekering",
      paymentStatus: "Betaalstatus",
      payment: {
        unpaid: "Niet betaald",
        not_required: "Geen kosten",
        pending: "In behandeling",
        awaiting_payment: "In afwachting van betaling",
        paid: "Betaald",
        waived: "Afgezien",
        failed: "Mislukt",
      },
      dueDate: "Vervaldatum",
      scheduledDate: "Geplande betaaldatum",
      paidNotice: "Uw verzekeringskosten zijn door ons team gevalideerd.",
      chosen: {
        pay_now: "U betaalt nu.",
        decline: "U hebt afgezien van de verzekering.",
        pay_later: "U betaalt later.",
      },
      instructions: "Betaalinstructies",
      validationNotice: "Een betaling geldt pas als ontvangen na validatie door ons team.",
      question: "Wilt u de verzekeringskosten betalen?",
      options: {
        pay_now: "Ja, nu betalen",
        decline: "Nee, afzien van de verzekering",
        pay_later: "Ja, later betalen",
      },
      optionsHint: {
        pay_now: "U ontvangt de betaalinstructies.",
        decline: "Uw dossier wordt zonder verzekering beoordeeld.",
        pay_later: "Kies een datum: u ontvangt herinneringen.",
      },
      pickDate: "Gewenste betaaldatum",
      confirmChoice: "Mijn keuze bevestigen",
      noPaymentNotice:
        "Deze keuze verricht geen betaling: zij wordt pas bevestigd na validatie door ons team.",
      choiceSaved: "Keuze opgeslagen",
      error: {
        dateRequired: "Kies een betaaldatum.",
        datePast: "De gekozen datum ligt in het verleden.",
        generic: "Actie niet mogelijk.",
      },
    },
  },

  pl: {
    emails: {
      insurancePayNow: {
        subject: "Ubezpieczenie — płatność natychmiastowa · sprawa {{reference}}",
        body: "Dzień dobry {{firstName}}, wybrano natychmiastową zapłatę opłaty ubezpieczeniowej {{amount}}.",
        details:
          "Instrukcje płatności (odbiorca, IBAN, BIC i tytuł przelewu) znajdują się w strefie bezpiecznej. Płatność uznaje się za otrzymaną dopiero po weryfikacji przez nasz zespół.",
      },
      insurancePayLater: {
        subject: "Ubezpieczenie — płatność zaplanowana · sprawa {{reference}}",
        body: "Dzień dobry {{firstName}}, płatność {{amount}} zaplanowano na {{date}}.",
        details:
          "Wniosek pozostaje zarezerwowany do wybranej daty. Można zapłacić wcześniej; przed terminem wyślemy przypomnienia.",
      },
      insuranceDeclined: {
        subject: "Ubezpieczenie — rezygnacja zapisana · sprawa {{reference}}",
        body: "Dzień dobry {{firstName}}, zapisaliśmy rezygnację z ubezpieczenia kredytobiorcy.",
        details:
          "Bez ubezpieczenia wniosek może zostać ponownie oceniony. Do czasu wypłaty środków można zmienić tę decyzję w strefie bezpiecznej.",
      },
      insurancePaymentValidated: {
        subject: "Ubezpieczenie — płatność potwierdzona · sprawa {{reference}}",
        body: "Dzień dobry {{firstName}}, potwierdzamy wpływ opłaty ubezpieczeniowej.",
        details:
          "Ochrona jest uruchamiana. Certyfikat i numer polisy pojawią się w strefie bezpiecznej po zatwierdzeniu polisy.",
      },
      insuranceReminder: {
        subject: "Przypomnienie — opłata ubezpieczeniowa · sprawa {{reference}}",
        body: "Dzień dobry {{firstName}}, płatność {{amount}} przypada {{date}}.",
        details:
          "To automatyczne przypomnienie przed wybraną datą. Instrukcje płatności znajdują się w strefie bezpiecznej.",
      },
    },
    insurance: {
      fee: "Opłata za uruchomienie ubezpieczenia",
      paymentStatus: "Status płatności",
      payment: {
        unpaid: "Niezapłacone",
        not_required: "Bez opłaty",
        pending: "Oczekuje",
        awaiting_payment: "Oczekuje na płatność",
        paid: "Zapłacone",
        waived: "Zrezygnowano",
        failed: "Niepowodzenie",
      },
      dueDate: "Termin płatności",
      scheduledDate: "Zaplanowana data płatności",
      paidNotice: "Opłata ubezpieczeniowa została zatwierdzona przez nasz zespół.",
      chosen: {
        pay_now: "Wybrano płatność natychmiastową.",
        decline: "Zrezygnowano z ubezpieczenia.",
        pay_later: "Wybrano płatność późniejszą.",
      },
      instructions: "Instrukcje płatności",
      validationNotice:
        "Płatność uznaje się za otrzymaną dopiero po weryfikacji przez nasz zespół.",
      question: "Czy chcesz opłacić ubezpieczenie?",
      options: {
        pay_now: "Tak, zapłać teraz",
        decline: "Nie, rezygnuję z ubezpieczenia",
        pay_later: "Tak, zapłacę później",
      },
      optionsHint: {
        pay_now: "Otrzymasz instrukcje płatności.",
        decline: "Wniosek zostanie rozpatrzony bez ubezpieczenia.",
        pay_later: "Wybierz datę: wyślemy przypomnienia.",
      },
      pickDate: "Preferowana data płatności",
      confirmChoice: "Potwierdzam wybór",
      noPaymentNotice:
        "Ten wybór nie realizuje płatności: jest potwierdzany dopiero po weryfikacji przez nasz zespół.",
      choiceSaved: "Wybór zapisany",
      error: {
        dateRequired: "Wybierz datę płatności.",
        datePast: "Wybrana data już minęła.",
        generic: "Operacja niemożliwa.",
      },
    },
  },

  ro: {
    emails: {
      insurancePayNow: {
        subject: "Asigurare — plată imediată · dosar {{reference}}",
        body: "Bună ziua {{firstName}}, ați ales să achitați imediat taxa de asigurare de {{amount}}.",
        details:
          "Instrucțiunile de plată (beneficiar, IBAN, BIC și referință) sunt în spațiul dvs. securizat. O plată este considerată primită doar după validarea echipei noastre.",
      },
      insurancePayLater: {
        subject: "Asigurare — plată programată · dosar {{reference}}",
        body: "Bună ziua {{firstName}}, plata de {{amount}} este programată pe {{date}}.",
        details:
          "Dosarul rămâne rezervat până la data aleasă. Puteți plăti mai devreme; veți primi memento-uri înainte de scadență.",
      },
      insuranceDeclined: {
        subject: "Asigurare — renunțare înregistrată · dosar {{reference}}",
        body: "Bună ziua {{firstName}}, am înregistrat renunțarea dvs. la asigurare.",
        details:
          "Fără asigurare, dosarul poate fi reanalizat de comitetul nostru. Puteți schimba această alegere până la deblocarea fondurilor.",
      },
      insurancePaymentValidated: {
        subject: "Asigurare — plată validată · dosar {{reference}}",
        body: "Bună ziua {{firstName}}, confirmăm primirea taxei de asigurare.",
        details:
          "Acoperirea este în curs de activare. Certificatul și numărul poliței vor apărea în spațiul securizat după validare.",
      },
      insuranceReminder: {
        subject: "Memento — taxă de asigurare · dosar {{reference}}",
        body: "Bună ziua {{firstName}}, plata de {{amount}} este scadentă pe {{date}}.",
        details:
          "Acest memento automat este trimis înainte de data aleasă. Instrucțiunile de plată sunt în spațiul securizat.",
      },
    },
    insurance: {
      fee: "Taxă de activare a asigurării",
      paymentStatus: "Starea plății",
      payment: {
        unpaid: "Neplătit",
        not_required: "Fără taxă",
        pending: "În așteptare",
        awaiting_payment: "În așteptarea plății",
        paid: "Plătit",
        waived: "Renunțat",
        failed: "Eșuat",
      },
      dueDate: "Data scadenței",
      scheduledDate: "Data de plată programată",
      paidNotice: "Taxa de asigurare a fost validată de echipa noastră.",
      chosen: {
        pay_now: "Ați ales să plătiți imediat.",
        decline: "Ați renunțat la asigurare.",
        pay_later: "Ați ales să plătiți mai târziu.",
      },
      instructions: "Instrucțiuni de plată",
      validationNotice: "O plată este considerată primită doar după validarea echipei noastre.",
      question: "Doriți să achitați taxa de asigurare?",
      options: {
        pay_now: "Da, plătesc acum",
        decline: "Nu, renunț la asigurare",
        pay_later: "Da, plătesc mai târziu",
      },
      optionsHint: {
        pay_now: "Veți primi instrucțiunile de plată.",
        decline: "Dosarul va fi analizat fără asigurare.",
        pay_later: "Alegeți o dată: veți primi memento-uri.",
      },
      pickDate: "Data de plată dorită",
      confirmChoice: "Confirm alegerea",
      noPaymentNotice:
        "Această alegere nu efectuează nicio plată: este confirmată doar după validarea echipei noastre.",
      choiceSaved: "Alegere înregistrată",
      error: {
        dateRequired: "Alegeți o dată de plată.",
        datePast: "Data aleasă este deja trecută.",
        generic: "Acțiune imposibilă.",
      },
    },
  },

  bg: {
    emails: {
      insurancePayNow: {
        subject: "Застраховка — незабавно плащане · досие {{reference}}",
        body: "Здравейте {{firstName}}, избрахте да платите таксата за застраховка от {{amount}} веднага.",
        details:
          "Инструкциите за плащане (получател, IBAN, BIC и основание) са в защитената ви зона. Плащането се счита за получено само след потвърждение от наш служител.",
      },
      insurancePayLater: {
        subject: "Застраховка — планирано плащане · досие {{reference}}",
        body: "Здравейте {{firstName}}, плащането от {{amount}} е планирано за {{date}}.",
        details:
          "Досието остава запазено до избраната дата. Можете да платите по-рано; ще получите напомняния преди падежа.",
      },
      insuranceDeclined: {
        subject: "Застраховка — отказ регистриран · досие {{reference}}",
        body: "Здравейте {{firstName}}, регистрирахме отказа ви от застраховка.",
        details:
          "Без застраховка досието може да бъде преразгледано. До усвояване на средствата можете да промените избора си.",
      },
      insurancePaymentValidated: {
        subject: "Застраховка — плащането е потвърдено · досие {{reference}}",
        body: "Здравейте {{firstName}}, потвърждаваме получаването на таксата за застраховка.",
        details:
          "Покритието се активира. Удостоверението и номерът на полицата ще бъдат налични в защитената зона след валидиране.",
      },
      insuranceReminder: {
        subject: "Напомняне — такса за застраховка · досие {{reference}}",
        body: "Здравейте {{firstName}}, плащането от {{amount}} е с падеж {{date}}.",
        details:
          "Това автоматично напомняне се изпраща преди избраната от вас дата. Инструкциите за плащане са в защитената зона.",
      },
    },
    insurance: {
      fee: "Такса за сключване на застраховка",
      paymentStatus: "Статус на плащането",
      payment: {
        unpaid: "Неплатено",
        not_required: "Без такса",
        pending: "Изчаква",
        awaiting_payment: "Очаква плащане",
        paid: "Платено",
        waived: "Отказано",
        failed: "Неуспешно",
      },
      dueDate: "Падеж на плащането",
      scheduledDate: "Планирана дата на плащане",
      paidNotice: "Таксата ви за застраховка е потвърдена от нашия екип.",
      chosen: {
        pay_now: "Избрахте плащане веднага.",
        decline: "Отказахте се от застраховката.",
        pay_later: "Избрахте плащане по-късно.",
      },
      instructions: "Инструкции за плащане",
      validationNotice: "Плащането се счита за получено само след потвърждение от нашия екип.",
      question: "Желаете ли да платите таксата за застраховка?",
      options: {
        pay_now: "Да, плащам сега",
        decline: "Не, отказвам застраховката",
        pay_later: "Да, плащам по-късно",
      },
      optionsHint: {
        pay_now: "Ще получите инструкции за плащане.",
        decline: "Досието ще бъде разгледано без застраховка.",
        pay_later: "Изберете дата: ще получите напомняния.",
      },
      pickDate: "Предпочитана дата на плащане",
      confirmChoice: "Потвърждавам избора",
      noPaymentNotice:
        "Този избор не извършва плащане: потвърждава се само след проверка от нашия екип.",
      choiceSaved: "Изборът е записан",
      error: {
        dateRequired: "Моля, изберете дата на плащане.",
        datePast: "Избраната дата вече е минала.",
        generic: "Действието е невъзможно.",
      },
    },
  },

  el: {
    emails: {
      insurancePayNow: {
        subject: "Ασφάλιση — άμεση πληρωμή · φάκελος {{reference}}",
        body: "Γεια σας {{firstName}}, επιλέξατε να πληρώσετε τώρα τα έξοδα ασφάλισης {{amount}}.",
        details:
          "Οι οδηγίες πληρωμής (δικαιούχος, IBAN, BIC και αιτιολογία) βρίσκονται στον ασφαλή σας χώρο. Η πληρωμή θεωρείται ληφθείσα μόνο μετά την επικύρωση από την ομάδα μας.",
      },
      insurancePayLater: {
        subject: "Ασφάλιση — προγραμματισμένη πληρωμή · φάκελος {{reference}}",
        body: "Γεια σας {{firstName}}, η πληρωμή {{amount}} έχει προγραμματιστεί για τις {{date}}.",
        details:
          "Ο φάκελος παραμένει δεσμευμένος έως την επιλεγμένη ημερομηνία. Μπορείτε να πληρώσετε νωρίτερα· θα λάβετε υπενθυμίσεις πριν τη λήξη.",
      },
      insuranceDeclined: {
        subject: "Ασφάλιση — παραίτηση καταχωρήθηκε · φάκελος {{reference}}",
        body: "Γεια σας {{firstName}}, καταγράψαμε την παραίτησή σας από την ασφάλιση.",
        details:
          "Χωρίς ασφάλιση, ο φάκελος μπορεί να επανεξεταστεί. Μπορείτε να αλλάξετε την επιλογή σας έως την εκταμίευση.",
      },
      insurancePaymentValidated: {
        subject: "Ασφάλιση — πληρωμή επικυρώθηκε · φάκελος {{reference}}",
        body: "Γεια σας {{firstName}}, επιβεβαιώνουμε τη λήψη των εξόδων ασφάλισης.",
        details:
          "Η κάλυψη ενεργοποιείται. Το πιστοποιητικό και ο αριθμός συμβολαίου θα εμφανιστούν στον ασφαλή σας χώρο μετά την επικύρωση.",
      },
      insuranceReminder: {
        subject: "Υπενθύμιση — έξοδα ασφάλισης · φάκελος {{reference}}",
        body: "Γεια σας {{firstName}}, η πληρωμή {{amount}} λήγει στις {{date}}.",
        details:
          "Αυτή η αυτόματη υπενθύμιση αποστέλλεται πριν από την ημερομηνία που επιλέξατε. Οι οδηγίες πληρωμής είναι στον ασφαλή σας χώρο.",
      },
    },
    insurance: {
      fee: "Έξοδα σύναψης ασφάλισης",
      paymentStatus: "Κατάσταση πληρωμής",
      payment: {
        unpaid: "Απλήρωτο",
        not_required: "Χωρίς έξοδα",
        pending: "Σε αναμονή",
        awaiting_payment: "Αναμονή πληρωμής",
        paid: "Πληρωμένο",
        waived: "Παραίτηση",
        failed: "Απέτυχε",
      },
      dueDate: "Ημερομηνία λήξης",
      scheduledDate: "Προγραμματισμένη ημερομηνία πληρωμής",
      paidNotice: "Τα έξοδα ασφάλισης επικυρώθηκαν από την ομάδα μας.",
      chosen: {
        pay_now: "Επιλέξατε άμεση πληρωμή.",
        decline: "Παραιτηθήκατε από την ασφάλιση.",
        pay_later: "Επιλέξατε πληρωμή αργότερα.",
      },
      instructions: "Οδηγίες πληρωμής",
      validationNotice: "Η πληρωμή θεωρείται ληφθείσα μόνο μετά την επικύρωση από την ομάδα μας.",
      question: "Θέλετε να πληρώσετε τα έξοδα ασφάλισης;",
      options: {
        pay_now: "Ναι, πληρωμή τώρα",
        decline: "Όχι, παραιτούμαι από την ασφάλιση",
        pay_later: "Ναι, πληρωμή αργότερα",
      },
      optionsHint: {
        pay_now: "Θα λάβετε τις οδηγίες πληρωμής.",
        decline: "Ο φάκελος θα εξεταστεί χωρίς ασφάλιση.",
        pay_later: "Επιλέξτε ημερομηνία: θα λάβετε υπενθυμίσεις.",
      },
      pickDate: "Επιθυμητή ημερομηνία πληρωμής",
      confirmChoice: "Επιβεβαίωση επιλογής",
      noPaymentNotice:
        "Αυτή η επιλογή δεν πραγματοποιεί πληρωμή: επιβεβαιώνεται μόνο μετά την επικύρωση από την ομάδα μας.",
      choiceSaved: "Η επιλογή αποθηκεύτηκε",
      error: {
        dateRequired: "Επιλέξτε ημερομηνία πληρωμής.",
        datePast: "Η επιλεγμένη ημερομηνία έχει παρέλθει.",
        generic: "Η ενέργεια δεν είναι δυνατή.",
      },
    },
  },

  fi: {
    emails: {
      insurancePayNow: {
        subject: "Vakuutus — välitön maksu · hakemus {{reference}}",
        body: "Hei {{firstName}}, valitsit maksaa vakuutusmaksun {{amount}} heti.",
        details:
          "Maksuohjeet (saaja, IBAN, BIC ja viite) löytyvät suojatusta palvelustasi. Maksu katsotaan vastaanotetuksi vasta tiimimme vahvistuksen jälkeen.",
      },
      insurancePayLater: {
        subject: "Vakuutus — maksu ajastettu · hakemus {{reference}}",
        body: "Hei {{firstName}}, {{amount}} maksu on ajastettu {{date}}.",
        details:
          "Hakemuksesi pysyy varattuna valittuun päivään asti. Voit maksaa aiemmin; lähetämme muistutuksia ennen eräpäivää.",
      },
      insuranceDeclined: {
        subject: "Vakuutus — luopuminen kirjattu · hakemus {{reference}}",
        body: "Hei {{firstName}}, olemme kirjanneet luopumisesi lainaturvavakuutuksesta.",
        details:
          "Ilman vakuutusta hakemus voidaan arvioida uudelleen. Voit muuttaa valintaasi ennen varojen maksamista.",
      },
      insurancePaymentValidated: {
        subject: "Vakuutus — maksu vahvistettu · hakemus {{reference}}",
        body: "Hei {{firstName}}, vahvistamme vakuutusmaksun vastaanoton.",
        details:
          "Vakuutusturvaa otetaan käyttöön. Todistus ja vakuutusnumero näkyvät suojatussa palvelussa vahvistuksen jälkeen.",
      },
      insuranceReminder: {
        subject: "Muistutus — vakuutusmaksu · hakemus {{reference}}",
        body: "Hei {{firstName}}, {{amount}} maksu erääntyy {{date}}.",
        details:
          "Tämä automaattinen muistutus lähetetään ennen valitsemaasi päivää. Maksuohjeet löytyvät suojatusta palvelusta.",
      },
    },
    insurance: {
      fee: "Vakuutuksen aloitusmaksu",
      paymentStatus: "Maksun tila",
      payment: {
        unpaid: "Maksamatta",
        not_required: "Ei maksua",
        pending: "Odottaa",
        awaiting_payment: "Odottaa maksua",
        paid: "Maksettu",
        waived: "Luovuttu",
        failed: "Epäonnistui",
      },
      dueDate: "Eräpäivä",
      scheduledDate: "Ajastettu maksupäivä",
      paidNotice: "Vakuutusmaksusi on vahvistettu tiimimme toimesta.",
      chosen: {
        pay_now: "Valitsit maksaa heti.",
        decline: "Luovuit vakuutuksesta.",
        pay_later: "Valitsit maksaa myöhemmin.",
      },
      instructions: "Maksuohjeet",
      validationNotice: "Maksu katsotaan vastaanotetuksi vasta tiimimme vahvistuksen jälkeen.",
      question: "Haluatko maksaa vakuutusmaksun?",
      options: {
        pay_now: "Kyllä, maksan nyt",
        decline: "Ei, luovun vakuutuksesta",
        pay_later: "Kyllä, maksan myöhemmin",
      },
      optionsHint: {
        pay_now: "Saat maksuohjeet.",
        decline: "Hakemus käsitellään ilman vakuutusta.",
        pay_later: "Valitse päivä: lähetämme muistutuksia.",
      },
      pickDate: "Toivottu maksupäivä",
      confirmChoice: "Vahvista valintani",
      noPaymentNotice:
        "Tämä valinta ei suorita maksua: se vahvistetaan vasta tiimimme tarkistuksen jälkeen.",
      choiceSaved: "Valinta tallennettu",
      error: {
        dateRequired: "Valitse maksupäivä.",
        datePast: "Valittu päivä on jo mennyt.",
        generic: "Toiminto ei ole mahdollinen.",
      },
    },
  },

  hr: {
    emails: {
      insurancePayNow: {
        subject: "Osiguranje — trenutno plaćanje · predmet {{reference}}",
        body: "Poštovani {{firstName}}, odabrali ste odmah platiti trošak osiguranja od {{amount}}.",
        details:
          "Upute za plaćanje (primatelj, IBAN, BIC i poziv na broj) nalaze se u vašem sigurnom prostoru. Plaćanje se smatra zaprimljenim tek nakon potvrde našeg tima.",
      },
      insurancePayLater: {
        subject: "Osiguranje — plaćanje zakazano · predmet {{reference}}",
        body: "Poštovani {{firstName}}, plaćanje od {{amount}} zakazano je za {{date}}.",
        details:
          "Predmet ostaje rezerviran do odabranog datuma. Možete platiti ranije; prije dospijeća šaljemo podsjetnike.",
      },
      insuranceDeclined: {
        subject: "Osiguranje — odricanje zabilježeno · predmet {{reference}}",
        body: "Poštovani {{firstName}}, zabilježili smo vaše odricanje od osiguranja.",
        details:
          "Bez osiguranja predmet može biti ponovno razmotren. Odluku možete promijeniti dok sredstva nisu isplaćena.",
      },
      insurancePaymentValidated: {
        subject: "Osiguranje — plaćanje potvrđeno · predmet {{reference}}",
        body: "Poštovani {{firstName}}, potvrđujemo primitak troška osiguranja.",
        details:
          "Pokriće se aktivira. Potvrda i broj police bit će dostupni u sigurnom prostoru nakon validacije.",
      },
      insuranceReminder: {
        subject: "Podsjetnik — trošak osiguranja · predmet {{reference}}",
        body: "Poštovani {{firstName}}, plaćanje od {{amount}} dospijeva {{date}}.",
        details:
          "Ovaj automatski podsjetnik šalje se prije datuma koji ste odabrali. Upute za plaćanje su u sigurnom prostoru.",
      },
    },
    insurance: {
      fee: "Trošak ugovaranja osiguranja",
      paymentStatus: "Status plaćanja",
      payment: {
        unpaid: "Neplaćeno",
        not_required: "Bez troška",
        pending: "U tijeku",
        awaiting_payment: "Čeka plaćanje",
        paid: "Plaćeno",
        waived: "Odustalo se",
        failed: "Neuspjelo",
      },
      dueDate: "Datum dospijeća",
      scheduledDate: "Zakazani datum plaćanja",
      paidNotice: "Vaš trošak osiguranja potvrdio je naš tim.",
      chosen: {
        pay_now: "Odabrali ste platiti odmah.",
        decline: "Odrekli ste se osiguranja.",
        pay_later: "Odabrali ste platiti kasnije.",
      },
      instructions: "Upute za plaćanje",
      validationNotice: "Plaćanje se smatra zaprimljenim tek nakon potvrde našeg tima.",
      question: "Želite li platiti trošak osiguranja?",
      options: {
        pay_now: "Da, platiti odmah",
        decline: "Ne, odričem se osiguranja",
        pay_later: "Da, platiti kasnije",
      },
      optionsHint: {
        pay_now: "Primit ćete upute za plaćanje.",
        decline: "Predmet će se razmatrati bez osiguranja.",
        pay_later: "Odaberite datum: šaljemo podsjetnike.",
      },
      pickDate: "Željeni datum plaćanja",
      confirmChoice: "Potvrdi odabir",
      noPaymentNotice:
        "Ovaj odabir ne izvršava plaćanje: potvrđuje se tek nakon provjere našeg tima.",
      choiceSaved: "Odabir spremljen",
      error: {
        dateRequired: "Odaberite datum plaćanja.",
        datePast: "Odabrani datum je već prošao.",
        generic: "Radnja nije moguća.",
      },
    },
  },

  hu: {
    emails: {
      insurancePayNow: {
        subject: "Biztosítás — azonnali fizetés · ügyszám {{reference}}",
        body: "Jó napot {{firstName}}, úgy döntött, hogy a {{amount}} biztosítási díjat azonnal kifizeti.",
        details:
          "A fizetési adatok (kedvezményezett, IBAN, BIC és közlemény) a biztonságos felületén érhetők el. A fizetés csak csapatunk jóváhagyása után minősül beérkezettnek.",
      },
      insurancePayLater: {
        subject: "Biztosítás — ütemezett fizetés · ügyszám {{reference}}",
        body: "Jó napot {{firstName}}, a {{amount}} összegű fizetés {{date}} napra van ütemezve.",
        details:
          "Ügye a választott dátumig fenntartva marad. Korábban is fizethet; a határidő előtt emlékeztetőket küldünk.",
      },
      insuranceDeclined: {
        subject: "Biztosítás — lemondás rögzítve · ügyszám {{reference}}",
        body: "Jó napot {{firstName}}, rögzítettük a hitelfedezeti biztosításról való lemondását.",
        details:
          "Biztosítás nélkül ügyét bizottságunk újra megvizsgálhatja. A folyósításig módosíthatja döntését.",
      },
      insurancePaymentValidated: {
        subject: "Biztosítás — fizetés jóváhagyva · ügyszám {{reference}}",
        body: "Jó napot {{firstName}}, visszaigazoljuk a biztosítási díj beérkezését.",
        details:
          "A fedezet beállítása folyamatban van. Az igazolás és a kötvényszám a jóváhagyás után elérhető a biztonságos felületen.",
      },
      insuranceReminder: {
        subject: "Emlékeztető — biztosítási díj · ügyszám {{reference}}",
        body: "Jó napot {{firstName}}, a {{amount}} összegű fizetés esedékessége {{date}}.",
        details:
          "Ez az automatikus emlékeztető a választott dátum előtt érkezik. A fizetési adatok a biztonságos felületen találhatók.",
      },
    },
    insurance: {
      fee: "Biztosítás létrehozási díja",
      paymentStatus: "Fizetés állapota",
      payment: {
        unpaid: "Nincs fizetve",
        not_required: "Díjmentes",
        pending: "Függőben",
        awaiting_payment: "Fizetésre vár",
        paid: "Kifizetve",
        waived: "Lemondva",
        failed: "Sikertelen",
      },
      dueDate: "Fizetési határidő",
      scheduledDate: "Ütemezett fizetési dátum",
      paidNotice: "Biztosítási díját csapatunk jóváhagyta.",
      chosen: {
        pay_now: "Az azonnali fizetést választotta.",
        decline: "Lemondott a biztosításról.",
        pay_later: "A későbbi fizetést választotta.",
      },
      instructions: "Fizetési adatok",
      validationNotice: "A fizetés csak csapatunk jóváhagyása után minősül beérkezettnek.",
      question: "Kifizeti a biztosítási díjat?",
      options: {
        pay_now: "Igen, fizetés most",
        decline: "Nem, lemondok a biztosításról",
        pay_later: "Igen, később fizetek",
      },
      optionsHint: {
        pay_now: "Megkapja a fizetési adatokat.",
        decline: "Ügyét biztosítás nélkül vizsgáljuk.",
        pay_later: "Válasszon dátumot: emlékeztetőket küldünk.",
      },
      pickDate: "Kívánt fizetési dátum",
      confirmChoice: "Választás megerősítése",
      noPaymentNotice:
        "Ez a választás nem indít fizetést: csak csapatunk ellenőrzése után válik véglegessé.",
      choiceSaved: "Választás mentve",
      error: {
        dateRequired: "Válasszon fizetési dátumot.",
        datePast: "A választott dátum már elmúlt.",
        generic: "A művelet nem lehetséges.",
      },
    },
  },

  sk: {
    emails: {
      insurancePayNow: {
        subject: "Poistenie — okamžitá platba · spis {{reference}}",
        body: "Dobrý deň {{firstName}}, rozhodli ste sa uhradiť poplatok za poistenie {{amount}} ihneď.",
        details:
          "Pokyny na platbu (príjemca, IBAN, BIC a variabilný symbol) nájdete vo svojej zabezpečenej zóne. Platba sa považuje za prijatú až po overení naším tímom.",
      },
      insurancePayLater: {
        subject: "Poistenie — naplánovaná platba · spis {{reference}}",
        body: "Dobrý deň {{firstName}}, platba {{amount}} je naplánovaná na {{date}}.",
        details:
          "Spis zostáva rezervovaný do zvoleného dátumu. Môžete zaplatiť skôr; pred splatnosťou pošleme pripomienky.",
      },
      insuranceDeclined: {
        subject: "Poistenie — vzdanie sa zaznamenané · spis {{reference}}",
        body: "Dobrý deň {{firstName}}, zaznamenali sme vzdanie sa poistenia.",
        details:
          "Bez poistenia môže byť spis znovu posúdený. Do vyplatenia prostriedkov môžete svoje rozhodnutie zmeniť.",
      },
      insurancePaymentValidated: {
        subject: "Poistenie — platba overená · spis {{reference}}",
        body: "Dobrý deň {{firstName}}, potvrdzujeme prijatie poplatku za poistenie.",
        details:
          "Krytie sa aktivuje. Potvrdenie a číslo poistky budú dostupné v zabezpečenej zóne po overení.",
      },
      insuranceReminder: {
        subject: "Pripomienka — poplatok za poistenie · spis {{reference}}",
        body: "Dobrý deň {{firstName}}, platba {{amount}} je splatná {{date}}.",
        details:
          "Táto automatická pripomienka sa odosiela pred vami zvoleným dátumom. Pokyny na platbu nájdete v zabezpečenej zóne.",
      },
    },
    insurance: {
      fee: "Poplatok za zriadenie poistenia",
      paymentStatus: "Stav platby",
      payment: {
        unpaid: "Nezaplatené",
        not_required: "Bez poplatku",
        pending: "Čaká sa",
        awaiting_payment: "Čaká na platbu",
        paid: "Zaplatené",
        waived: "Vzdanie sa",
        failed: "Zlyhalo",
      },
      dueDate: "Dátum splatnosti",
      scheduledDate: "Naplánovaný dátum platby",
      paidNotice: "Váš poplatok za poistenie overil náš tím.",
      chosen: {
        pay_now: "Zvolili ste okamžitú platbu.",
        decline: "Vzdali ste sa poistenia.",
        pay_later: "Zvolili ste platbu neskôr.",
      },
      instructions: "Pokyny na platbu",
      validationNotice: "Platba sa považuje za prijatú až po overení naším tímom.",
      question: "Chcete uhradiť poplatok za poistenie?",
      options: {
        pay_now: "Áno, zaplatiť teraz",
        decline: "Nie, vzdávam sa poistenia",
        pay_later: "Áno, zaplatiť neskôr",
      },
      optionsHint: {
        pay_now: "Dostanete pokyny na platbu.",
        decline: "Spis sa posúdi bez poistenia.",
        pay_later: "Vyberte dátum: pošleme pripomienky.",
      },
      pickDate: "Želaný dátum platby",
      confirmChoice: "Potvrdiť voľbu",
      noPaymentNotice: "Táto voľba nevykonáva platbu: potvrdzuje sa až po overení naším tímom.",
      choiceSaved: "Voľba uložená",
      error: {
        dateRequired: "Vyberte dátum platby.",
        datePast: "Zvolený dátum už uplynul.",
        generic: "Akcia nie je možná.",
      },
    },
  },

  sl: {
    emails: {
      insurancePayNow: {
        subject: "Zavarovanje — takojšnje plačilo · zadeva {{reference}}",
        body: "Pozdravljeni {{firstName}}, izbrali ste takojšnje plačilo stroška zavarovanja {{amount}}.",
        details:
          "Navodila za plačilo (prejemnik, IBAN, BIC in sklic) so v vašem varnem območju. Plačilo velja za prejeto šele po potrditvi naše ekipe.",
      },
      insurancePayLater: {
        subject: "Zavarovanje — načrtovano plačilo · zadeva {{reference}}",
        body: "Pozdravljeni {{firstName}}, plačilo {{amount}} je načrtovano za {{date}}.",
        details:
          "Zadeva ostane rezervirana do izbranega datuma. Plačate lahko prej; pred zapadlostjo pošljemo opomnike.",
      },
      insuranceDeclined: {
        subject: "Zavarovanje — odpoved zabeležena · zadeva {{reference}}",
        body: "Pozdravljeni {{firstName}}, zabeležili smo vašo odpoved zavarovanju.",
        details:
          "Brez zavarovanja se zadeva lahko ponovno presodi. Odločitev lahko spremenite do izplačila sredstev.",
      },
      insurancePaymentValidated: {
        subject: "Zavarovanje — plačilo potrjeno · zadeva {{reference}}",
        body: "Pozdravljeni {{firstName}}, potrjujemo prejem stroška zavarovanja.",
        details:
          "Kritje se vzpostavlja. Potrdilo in številka police bosta po potrditvi na voljo v varnem območju.",
      },
      insuranceReminder: {
        subject: "Opomnik — strošek zavarovanja · zadeva {{reference}}",
        body: "Pozdravljeni {{firstName}}, plačilo {{amount}} zapade {{date}}.",
        details:
          "Ta samodejni opomnik je poslan pred izbranim datumom. Navodila za plačilo so v varnem območju.",
      },
    },
    insurance: {
      fee: "Strošek sklenitve zavarovanja",
      paymentStatus: "Stanje plačila",
      payment: {
        unpaid: "Neplačano",
        not_required: "Brez stroška",
        pending: "V obdelavi",
        awaiting_payment: "Čaka na plačilo",
        paid: "Plačano",
        waived: "Odpovedano",
        failed: "Neuspešno",
      },
      dueDate: "Datum zapadlosti",
      scheduledDate: "Načrtovani datum plačila",
      paidNotice: "Vaš strošek zavarovanja je potrdila naša ekipa.",
      chosen: {
        pay_now: "Izbrali ste takojšnje plačilo.",
        decline: "Odpovedali ste se zavarovanju.",
        pay_later: "Izbrali ste poznejše plačilo.",
      },
      instructions: "Navodila za plačilo",
      validationNotice: "Plačilo velja za prejeto šele po potrditvi naše ekipe.",
      question: "Želite plačati strošek zavarovanja?",
      options: {
        pay_now: "Da, plačam zdaj",
        decline: "Ne, odpovedujem se zavarovanju",
        pay_later: "Da, plačam pozneje",
      },
      optionsHint: {
        pay_now: "Prejeli boste navodila za plačilo.",
        decline: "Zadeva bo obravnavana brez zavarovanja.",
        pay_later: "Izberite datum: poslali bomo opomnike.",
      },
      pickDate: "Želeni datum plačila",
      confirmChoice: "Potrdi izbiro",
      noPaymentNotice: "Ta izbira ne izvede plačila: potrjena je šele po preveritvi naše ekipe.",
      choiceSaved: "Izbira shranjena",
      error: {
        dateRequired: "Izberite datum plačila.",
        datePast: "Izbrani datum je že mimo.",
        generic: "Dejanje ni mogoče.",
      },
    },
  },
};

/** Fusion profonde non destructive : n'écrase jamais une valeur existante. */
function mergeMissing(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ??= {};
      mergeMissing(target[key], value);
    } else if (target[key] === undefined) {
      target[key] = value;
    }
  }
  return target;
}

let updated = 0;
for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith(".json")) continue;
  const lang = file.replace(".json", "");
  const pack = T[lang] ?? T.en; // repli anglais si une locale n'est pas listée
  const p = path.join(DIR, file);
  const json = JSON.parse(fs.readFileSync(p, "utf8"));

  json.emails ??= {};
  mergeMissing(json.emails, pack.emails);

  json.finance ??= {};
  json.finance.insurance ??= {};
  mergeMissing(json.finance.insurance, pack.insurance);

  fs.writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
  updated += 1;
  console.log("updated", file);
}
console.log(`${updated} locales mises à jour.`);
