import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Buffer } from "node:buffer";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SUPPORTED = ["fr", "en", "de", "es", "it", "nl", "sl", "bg", "sk"] as const;
type Lang = (typeof SUPPORTED)[number];

const inputSchema = z.object({
  loanId: z.string().uuid(),
  accessToken: z.string().min(20),
  locale: z.string().optional(),
});

const LOCALE_MAP: Record<Lang, string> = {
  fr: "fr-FR", en: "en-GB", de: "de-DE", es: "es-ES", it: "it-IT",
  nl: "nl-NL", sl: "sl-SI", bg: "bg-BG", sk: "sk-SK",
};

type PdfDict = {
  subtitle: string; docTitle: string; docHint: string; title: string;
  partiesTitle: string; lender: string; borrower: string;
  conditionsTitle: string; amountLabel: string; durationLabel: string; rateLabel: string;
  months: string; monthly: string; perMonth: string; interestCost: string; totalDue: string; purpose: string; notSpecified: string;
  engagementsTitle: string; clauses: string[];
  signatureTitle: string; lenderSig: string; lenderName: string; borrowerSig: string; signMention: string;
  signedElectronically: string; certificate: string; certificatePrefix: string;
  refPrefix: string; issuedOn: string; page: string;
  footer: string; sessionExpired: string; loanNotFound: string; unauthorized: string;
  smallTitle: string;
};

const PDF_DICT: Record<Lang, PdfDict> = {
  fr: {
    subtitle: "Crédit en ligne — Contrat officiel",
    docTitle: "Contrat de prêt — BNP PARIBAS",
    docHint: "Document contractuel — à conserver précieusement",
    title: "Contrat de prêt personnel",
    partiesTitle: "1. Parties", lender: "Prêteur", borrower: "Emprunteur",
    conditionsTitle: "2. Conditions du prêt",
    amountLabel: "MONTANT DU PRÊT", durationLabel: "DURÉE", rateLabel: "TAEG FIXE",
    months: "mois", monthly: "Mensualité", perMonth: "/ mois",
    interestCost: "Coût total des intérêts", totalDue: "Montant total dû",
    purpose: "Objet du prêt", notSpecified: "Non précisé",
    engagementsTitle: "3. Engagements",
    clauses: [
      "L'emprunteur s'engage à rembourser le capital prêté augmenté des intérêts selon les",
      "mensualités définies ci-dessus. Le prêt est fixe et amortissable mensuellement.",
      "",
      "Tout retard de paiement de plus de 30 jours pourra entraîner l'exigibilité immédiate",
      "du capital restant dû, des intérêts échus et des frais y afférents.",
      "",
      "L'emprunteur dispose d'un délai légal de rétractation de 14 jours calendaires à",
      "compter de la signature du présent contrat (art. L312-19 du Code de la consommation).",
    ],
    signatureTitle: "4. Acceptation et signature",
    lenderSig: "Signature du prêteur", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Signature de l'emprunteur",
    signMention: 'Faire précéder la signature de la mention "Lu et approuvé"',
    signedElectronically: "Signé électroniquement", certificate: "Certificat",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Réf.", issuedOn: "Émis le", page: "Page 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Session expirée. Veuillez vous reconnecter.",
    loanNotFound: "Prêt introuvable", unauthorized: "Accès non autorisé à ce contrat",
    smallTitle: "Crédit en ligne",
  },
  en: {
    subtitle: "Online credit — Official contract",
    docTitle: "Loan agreement — BNP PARIBAS",
    docHint: "Contractual document — please keep carefully",
    title: "Personal loan agreement",
    partiesTitle: "1. Parties", lender: "Lender", borrower: "Borrower",
    conditionsTitle: "2. Loan terms",
    amountLabel: "LOAN AMOUNT", durationLabel: "DURATION", rateLabel: "FIXED APR",
    months: "months", monthly: "Monthly payment", perMonth: "/ month",
    interestCost: "Total interest cost", totalDue: "Total amount due",
    purpose: "Loan purpose", notSpecified: "Not specified",
    engagementsTitle: "3. Commitments",
    clauses: [
      "The borrower undertakes to repay the loaned capital plus interest according to the",
      "monthly instalments defined above. The loan is fixed and amortized monthly.",
      "",
      "Any payment delay exceeding 30 days may result in immediate enforceability of the",
      "outstanding capital, accrued interest and related charges.",
      "",
      "The borrower has a legal cooling-off period of 14 calendar days from the signature",
      "of this contract (art. L312-19 of the French Consumer Code).",
    ],
    signatureTitle: "4. Acceptance and signature",
    lenderSig: "Lender signature", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Borrower signature",
    signMention: 'Precede the signature with "Read and approved"',
    signedElectronically: "Electronically signed", certificate: "Certificate",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Ref.", issuedOn: "Issued on", page: "Page 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Session expired. Please sign in again.",
    loanNotFound: "Loan not found", unauthorized: "Unauthorized access to this contract",
    smallTitle: "Online credit",
  },
  de: {
    subtitle: "Online-Kredit — Offizieller Vertrag",
    docTitle: "Darlehensvertrag — BNP PARIBAS",
    docHint: "Vertragsdokument — bitte sorgfältig aufbewahren",
    title: "Privatdarlehensvertrag",
    partiesTitle: "1. Parteien", lender: "Darlehensgeber", borrower: "Darlehensnehmer",
    conditionsTitle: "2. Darlehensbedingungen",
    amountLabel: "DARLEHENSBETRAG", durationLabel: "LAUFZEIT", rateLabel: "FESTER EFF. JZ.",
    months: "Monate", monthly: "Monatsrate", perMonth: "/ Monat",
    interestCost: "Gesamtzinskosten", totalDue: "Gesamtbetrag",
    purpose: "Verwendungszweck", notSpecified: "Nicht angegeben",
    engagementsTitle: "3. Verpflichtungen",
    clauses: [
      "Der Darlehensnehmer verpflichtet sich, das geliehene Kapital zuzüglich Zinsen gemäß",
      "den oben definierten Monatsraten zurückzuzahlen. Das Darlehen ist fest und monatlich tilgend.",
      "",
      "Jeder Zahlungsverzug von mehr als 30 Tagen kann die sofortige Fälligkeit des",
      "Restkapitals, der aufgelaufenen Zinsen und der damit verbundenen Gebühren auslösen.",
      "",
      "Der Darlehensnehmer hat ein gesetzliches Widerrufsrecht von 14 Kalendertagen ab",
      "der Unterzeichnung dieses Vertrags.",
    ],
    signatureTitle: "4. Annahme und Unterschrift",
    lenderSig: "Unterschrift des Darlehensgebers", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Unterschrift des Darlehensnehmers",
    signMention: 'Der Unterschrift "Gelesen und genehmigt" voranstellen',
    signedElectronically: "Elektronisch signiert", certificate: "Zertifikat",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Ref.", issuedOn: "Ausgestellt am", page: "Seite 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Sitzung abgelaufen. Bitte erneut anmelden.",
    loanNotFound: "Darlehen nicht gefunden", unauthorized: "Unbefugter Zugriff auf diesen Vertrag",
    smallTitle: "Online-Kredit",
  },
  es: {
    subtitle: "Crédito en línea — Contrato oficial",
    docTitle: "Contrato de préstamo — BNP PARIBAS",
    docHint: "Documento contractual — consérvelo cuidadosamente",
    title: "Contrato de préstamo personal",
    partiesTitle: "1. Partes", lender: "Prestamista", borrower: "Prestatario",
    conditionsTitle: "2. Condiciones del préstamo",
    amountLabel: "IMPORTE DEL PRÉSTAMO", durationLabel: "DURACIÓN", rateLabel: "TAE FIJA",
    months: "meses", monthly: "Cuota mensual", perMonth: "/ mes",
    interestCost: "Coste total de intereses", totalDue: "Importe total adeudado",
    purpose: "Finalidad del préstamo", notSpecified: "No especificado",
    engagementsTitle: "3. Compromisos",
    clauses: [
      "El prestatario se compromete a reembolsar el capital prestado más los intereses según",
      "las cuotas mensuales definidas anteriormente. El préstamo es fijo y amortizable mensualmente.",
      "",
      "Cualquier retraso en el pago superior a 30 días podrá conllevar la exigibilidad inmediata",
      "del capital pendiente, los intereses devengados y los gastos asociados.",
      "",
      "El prestatario dispone de un plazo legal de desistimiento de 14 días naturales desde",
      "la firma del presente contrato.",
    ],
    signatureTitle: "4. Aceptación y firma",
    lenderSig: "Firma del prestamista", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Firma del prestatario",
    signMention: 'Anteponga a la firma la mención "Leído y aprobado"',
    signedElectronically: "Firmado electrónicamente", certificate: "Certificado",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Ref.", issuedOn: "Emitido el", page: "Página 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Sesión caducada. Por favor inicie sesión de nuevo.",
    loanNotFound: "Préstamo no encontrado", unauthorized: "Acceso no autorizado a este contrato",
    smallTitle: "Crédito en línea",
  },
  it: {
    subtitle: "Credito online — Contratto ufficiale",
    docTitle: "Contratto di prestito — BNP PARIBAS",
    docHint: "Documento contrattuale — da conservare con cura",
    title: "Contratto di prestito personale",
    partiesTitle: "1. Parti", lender: "Prestatore", borrower: "Mutuatario",
    conditionsTitle: "2. Condizioni del prestito",
    amountLabel: "IMPORTO DEL PRESTITO", durationLabel: "DURATA", rateLabel: "TAEG FISSO",
    months: "mesi", monthly: "Rata mensile", perMonth: "/ mese",
    interestCost: "Costo totale degli interessi", totalDue: "Importo totale dovuto",
    purpose: "Scopo del prestito", notSpecified: "Non specificato",
    engagementsTitle: "3. Impegni",
    clauses: [
      "Il mutuatario si impegna a rimborsare il capitale prestato maggiorato degli interessi",
      "secondo le rate mensili definite sopra. Il prestito è fisso e ammortizzabile mensilmente.",
      "",
      "Qualsiasi ritardo di pagamento superiore a 30 giorni potrà comportare l'esigibilità immediata",
      "del capitale residuo, degli interessi maturati e degli oneri correlati.",
      "",
      "Il mutuatario dispone di un termine legale di recesso di 14 giorni di calendario dalla",
      "firma del presente contratto.",
    ],
    signatureTitle: "4. Accettazione e firma",
    lenderSig: "Firma del prestatore", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Firma del mutuatario",
    signMention: 'Anteporre alla firma la dicitura "Letto e approvato"',
    signedElectronically: "Firmato elettronicamente", certificate: "Certificato",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Rif.", issuedOn: "Emesso il", page: "Pagina 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Sessione scaduta. Effettuare nuovamente l'accesso.",
    loanNotFound: "Prestito non trovato", unauthorized: "Accesso non autorizzato a questo contratto",
    smallTitle: "Credito online",
  },
  nl: {
    subtitle: "Online krediet — Officieel contract",
    docTitle: "Leningsovereenkomst — BNP PARIBAS",
    docHint: "Contractueel document — zorgvuldig bewaren",
    title: "Persoonlijke leningsovereenkomst",
    partiesTitle: "1. Partijen", lender: "Kredietverstrekker", borrower: "Kredietnemer",
    conditionsTitle: "2. Leningsvoorwaarden",
    amountLabel: "LEENBEDRAG", durationLabel: "LOOPTIJD", rateLabel: "VASTE JKP",
    months: "maanden", monthly: "Maandbedrag", perMonth: "/ maand",
    interestCost: "Totale rentekosten", totalDue: "Totaal verschuldigd bedrag",
    purpose: "Doel van de lening", notSpecified: "Niet gespecificeerd",
    engagementsTitle: "3. Verbintenissen",
    clauses: [
      "De kredietnemer verbindt zich ertoe het geleende kapitaal vermeerderd met rente terug te",
      "betalen volgens de hierboven vastgestelde maandelijkse termijnen.",
      "",
      "Elke betalingsachterstand van meer dan 30 dagen kan leiden tot onmiddellijke opeisbaarheid",
      "van het uitstaande kapitaal, de vervallen rente en bijbehorende kosten.",
      "",
      "De kredietnemer beschikt over een wettelijke bedenktijd van 14 kalenderdagen vanaf de",
      "ondertekening van dit contract.",
    ],
    signatureTitle: "4. Aanvaarding en handtekening",
    lenderSig: "Handtekening kredietverstrekker", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Handtekening kredietnemer",
    signMention: 'Laat de handtekening voorafgaan door "Gelezen en goedgekeurd"',
    signedElectronically: "Elektronisch ondertekend", certificate: "Certificaat",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Ref.", issuedOn: "Uitgegeven op", page: "Pagina 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Sessie verlopen. Log opnieuw in.",
    loanNotFound: "Lening niet gevonden", unauthorized: "Onbevoegde toegang tot dit contract",
    smallTitle: "Online krediet",
  },
  sl: {
    subtitle: "Spletni kredit — Uradna pogodba",
    docTitle: "Posojilna pogodba — BNP PARIBAS",
    docHint: "Pogodbeni dokument — skrbno shranite",
    title: "Pogodba o osebnem posojilu",
    partiesTitle: "1. Stranki", lender: "Posojilodajalec", borrower: "Posojilojemalec",
    conditionsTitle: "2. Pogoji posojila",
    amountLabel: "ZNESEK POSOJILA", durationLabel: "TRAJANJE", rateLabel: "FIKSNI EOM",
    months: "mesecev", monthly: "Mesečni obrok", perMonth: "/ mesec",
    interestCost: "Skupni stroški obresti", totalDue: "Skupni dolgovani znesek",
    purpose: "Namen posojila", notSpecified: "Ni navedeno",
    engagementsTitle: "3. Obveznosti",
    clauses: [
      "Posojilojemalec se zavezuje, da bo izposojeni kapital z obrestmi vrnil v skladu z",
      "zgoraj določenimi mesečnimi obroki. Posojilo je fiksno in se amortizira mesečno.",
      "",
      "Vsaka zamuda plačila, daljša od 30 dni, lahko povzroči takojšnjo zapadlost preostalega",
      "kapitala, zapadlih obresti in povezanih stroškov.",
      "",
      "Posojilojemalec ima zakonski rok za odstop 14 koledarskih dni od podpisa te pogodbe.",
    ],
    signatureTitle: "4. Sprejem in podpis",
    lenderSig: "Podpis posojilodajalca", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Podpis posojilojemalca",
    signMention: 'Pred podpisom dodajte "Prebrano in odobreno"',
    signedElectronically: "Elektronsko podpisano", certificate: "Potrdilo",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Ref.", issuedOn: "Izdano dne", page: "Stran 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Seja je potekla. Prosimo, prijavite se znova.",
    loanNotFound: "Posojilo ni najdeno", unauthorized: "Nepooblaščen dostop do te pogodbe",
    smallTitle: "Spletni kredit",
  },
  bg: {
    subtitle: "Онлайн кредит — Официален договор",
    docTitle: "Договор за заем — BNP PARIBAS",
    docHint: "Договорен документ — съхранявайте грижливо",
    title: "Договор за личен заем",
    partiesTitle: "1. Страни", lender: "Заемодател", borrower: "Заемополучател",
    conditionsTitle: "2. Условия на заема",
    amountLabel: "СУМА НА ЗАЕМА", durationLabel: "СРОК", rateLabel: "ФИКСИРАН ГПР",
    months: "месеца", monthly: "Месечна вноска", perMonth: "/ месец",
    interestCost: "Общи разходи за лихва", totalDue: "Обща дължима сума",
    purpose: "Цел на заема", notSpecified: "Не е посочено",
    engagementsTitle: "3. Задължения",
    clauses: [
      "Заемополучателят се задължава да върне заетия капитал, увеличен с лихвите, съгласно",
      "месечните вноски, определени по-горе. Заемът е фиксиран и месечно амортизиран.",
      "",
      "Всяко забавяне на плащане над 30 дни може да доведе до незабавна изискуемост на",
      "оставащия капитал, натрупаните лихви и свързаните такси.",
      "",
      "Заемополучателят разполага със законов срок за отказ от 14 календарни дни от",
      "подписването на този договор.",
    ],
    signatureTitle: "4. Приемане и подпис",
    lenderSig: "Подпис на заемодателя", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Подпис на заемополучателя",
    signMention: 'Преди подписа добавете „Прочетено и одобрено"',
    signedElectronically: "Електронно подписано", certificate: "Сертификат",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Реф.", issuedOn: "Издадено на", page: "Страница 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Сесията е изтекла. Моля, влезте отново.",
    loanNotFound: "Заемът не е намерен", unauthorized: "Неоторизиран достъп до този договор",
    smallTitle: "Онлайн кредит",
  },
  sk: {
    subtitle: "Online úver — Oficiálna zmluva",
    docTitle: "Zmluva o úvere — BNP PARIBAS",
    docHint: "Zmluvný dokument — starostlivo uschovajte",
    title: "Zmluva o osobnom úvere",
    partiesTitle: "1. Zmluvné strany", lender: "Veriteľ", borrower: "Dlžník",
    conditionsTitle: "2. Podmienky úveru",
    amountLabel: "VÝŠKA ÚVERU", durationLabel: "DOBA SPLATNOSTI", rateLabel: "FIXNÁ RPMN",
    months: "mesiacov", monthly: "Mesačná splátka", perMonth: "/ mesiac",
    interestCost: "Celkové úrokové náklady", totalDue: "Celková dlžná suma",
    purpose: "Účel úveru", notSpecified: "Neuvedené",
    engagementsTitle: "3. Záväzky",
    clauses: [
      "Dlžník sa zaväzuje splatiť požičaný kapitál zvýšený o úroky podľa mesačných splátok",
      "definovaných vyššie. Úver je fixný a mesačne amortizovaný.",
      "",
      "Akékoľvek omeškanie platby viac ako 30 dní môže viesť k okamžitej splatnosti zostávajúceho",
      "kapitálu, naakumulovaných úrokov a súvisiacich poplatkov.",
      "",
      "Dlžník má zákonnú lehotu na odstúpenie 14 kalendárnych dní od podpisu tejto zmluvy.",
    ],
    signatureTitle: "4. Prijatie a podpis",
    lenderSig: "Podpis veriteľa", lenderName: "BNP PARIBAS SAS",
    borrowerSig: "Podpis dlžníka",
    signMention: 'Pred podpis uveďte „Prečítané a schválené"',
    signedElectronically: "Elektronicky podpísané", certificate: "Certifikát",
    certificatePrefix: "BNP PARIBAS-eSign-",
    refPrefix: "Ref.", issuedOn: "Vydané dňa", page: "Strana 1 / 1",
    footer: "BNP PARIBAS SAS · support@bnpparibas.myinvest-capital.com",
    sessionExpired: "Relácia vypršala. Prihláste sa znova.",
    loanNotFound: "Úver nenájdený", unauthorized: "Neoprávnený prístup k tejto zmluve",
    smallTitle: "Online úver",
  },
};

function pickLang(loc: string | undefined): Lang {
  if (!loc) return "fr";
  const short = loc.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED as readonly string[]).includes(short) ? (short as Lang) : "fr";
}

// Helvetica (WinAnsi) cannot encode chars like narrow nbsp + non-Latin scripts (Cyrillic).
// Strip narrow spaces/quotes; replace non-WinAnsi chars with "?" so PDF still renders.
function sanitize(s: string): string {
  const cleaned = s
    .replace(/\u202F/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\u2009/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2013|\u2014/g, "-");
  // WinAnsi covers up to U+00FF + a few extras. Drop anything else to keep PDF safe.
  return cleaned.replace(/[^\x00-\xFF\u20AC\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192]/g, "?");
}

function eur(n: number, lang: Lang) {
  return sanitize(new Intl.NumberFormat(LOCALE_MAP[lang], { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n));
}

function date(iso: string, lang: Lang) {
  return sanitize(new Intl.DateTimeFormat(LOCALE_MAP[lang], { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso)));
}

// Estimate effective annual interest (TAEG) — fixed demo rate
const ANNUAL_RATE = 0.049; // 4.9%
function monthlyPayment(principal: number, months: number, annualRate: number) {
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export const generateContractPdf = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const lang = pickLang(data.locale);
    const T = PDF_DICT[lang];

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (authError || !authData.user) throw new Error(T.sessionExpired);

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;

    const { data: loan, error } = await supabaseAdmin
      .from("loans")
      .select("id, user_id, full_name, email, address, amount, duration_months, monthly_income, purpose, status, created_at")
      .eq("id", data.loanId)
      .maybeSingle();

    if (error || !loan) throw new Error(T.loanNotFound);
    if (!isAdmin && loan.user_id !== authData.user.id) throw new Error(T.unauthorized);

    const amount = Number(loan.amount);
    const months = Number(loan.duration_months);
    const monthly = monthlyPayment(amount, months, ANNUAL_RATE);
    const totalCost = monthly * months;
    const interestCost = totalCost - amount;

    // Build PDF
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${T.docTitle} — ${loan.id.slice(0, 8)}`);
    pdf.setAuthor("BNP PARIBAS");
    pdf.setCreator("BNP PARIBAS");
    pdf.setProducer("BNP PARIBAS Contract Generator");
    pdf.setCreationDate(new Date());

    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page = pdf.addPage([595.28, 841.89]);
    const originalDrawText = page.drawText.bind(page);
    page.drawText = ((text: string, options?: Parameters<typeof originalDrawText>[1]) =>
      originalDrawText(sanitize(text), options)) as typeof page.drawText;
    const width = page.getWidth();
    const height = page.getHeight();

    const ink = rgb(0.10, 0.10, 0.12);
    const muted = rgb(0.42, 0.42, 0.46);
    const accent = rgb(0.13, 0.55, 0.43);
    const line = rgb(0.86, 0.86, 0.86);

    const margin = 50;
    let y = height - margin;

    const bnpparibasRed = rgb(0.85, 0.0, 0.0);
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.98, 0.98, 0.97) });
    const lx = margin, ly = height - 60, ls = 32;
    page.drawRectangle({ x: lx, y: ly, width: ls, height: ls, color: rgb(1, 1, 1), borderColor: bnpparibasRed, borderWidth: 1 });
    page.drawRectangle({ x: lx, y: ly + ls / 2, width: ls / 2, height: ls / 2, color: bnpparibasRed });
    page.drawRectangle({ x: lx + ls / 2, y: ly, width: ls / 2, height: ls / 2, color: bnpparibasRed });
    page.drawText("BNP PARIBAS", { x: margin + 42, y: height - 47, size: 16, font: helvBold, color: bnpparibasRed });
    page.drawText(T.subtitle, { x: margin + 42, y: height - 62, size: 8, font: helv, color: muted });

    const refText = sanitize(`${T.refPrefix} ${loan.id.slice(0, 8).toUpperCase()}`);
    const refW = helvBold.widthOfTextAtSize(refText, 10);
    page.drawText(refText, { x: width - margin - refW, y: height - 47, size: 10, font: helvBold, color: ink });
    const dateText = sanitize(`${T.issuedOn} ${date(new Date().toISOString(), lang)}`);
    const dateW = helv.widthOfTextAtSize(dateText, 9);
    page.drawText(dateText, { x: width - margin - dateW, y: height - 62, size: 9, font: helv, color: muted });

    y = height - 110;
    page.drawText(T.title, { x: margin, y, size: 22, font: helvBold, color: ink });
    y -= 26;
    page.drawText(T.docHint, { x: margin, y, size: 10, font: helv, color: muted });
    y -= 28;

    drawSectionTitle(page, helvBold, T.partiesTitle, margin, y, ink, accent);
    y -= 22;
    drawKV(page, helv, helvBold, T.lender, sanitize("BNP PARIBAS SAS - 12 rue de la Finance, 75002 Paris"), margin, y, ink, muted);
    y -= 16;
    drawKV(page, helv, helvBold, T.borrower, sanitize(`${loan.full_name} - ${loan.email}`), margin, y, ink, muted);
    y -= 16;
    if ((loan as any).address) {
      drawKV(page, helv, helvBold, T.borrower + " (adresse)", sanitize(String((loan as any).address)), margin, y, ink, muted);
      y -= 16;
    }
    y -= 12;

    drawSectionTitle(page, helvBold, T.conditionsTitle, margin, y, ink, accent);
    y -= 22;

    const boxY = y - 60;
    page.drawRectangle({
      x: margin, y: boxY, width: width - margin * 2, height: 70,
      color: rgb(0.97, 0.99, 0.97), borderColor: rgb(0.85, 0.92, 0.87), borderWidth: 1,
    });
    page.drawText(T.amountLabel, { x: margin + 16, y: y - 14, size: 8, font: helvBold, color: muted });
    page.drawText(eur(amount, lang), { x: margin + 16, y: y - 38, size: 26, font: helvBold, color: ink });

    page.drawText(T.durationLabel, { x: margin + 220, y: y - 14, size: 8, font: helvBold, color: muted });
    page.drawText(`${months} ${T.months}`, { x: margin + 220, y: y - 38, size: 18, font: helvBold, color: ink });

    page.drawText(T.rateLabel, { x: margin + 360, y: y - 14, size: 8, font: helvBold, color: muted });
    page.drawText(`${(ANNUAL_RATE * 100).toFixed(2)} %`, { x: margin + 360, y: y - 38, size: 18, font: helvBold, color: accent });

    y = boxY - 22;

    drawKV(page, helv, helvBold, T.monthly, `${eur(monthly, lang)} ${T.perMonth}`, margin, y, ink, muted);
    y -= 16;
    drawKV(page, helv, helvBold, T.interestCost, eur(interestCost, lang), margin, y, ink, muted);
    y -= 16;
    drawKV(page, helv, helvBold, T.totalDue, eur(totalCost, lang), margin, y, ink, muted);
    y -= 16;
    drawKV(page, helv, helvBold, T.purpose, sanitize(loan.purpose || T.notSpecified), margin, y, ink, muted);
    y -= 28;

    drawSectionTitle(page, helvBold, T.engagementsTitle, margin, y, ink, accent);
    y -= 22;
    for (const ln of T.clauses) {
      page.drawText(ln, { x: margin, y, size: 9.5, font: helv, color: ink });
      y -= 13;
    }

    y -= 18;
    drawSectionTitle(page, helvBold, T.signatureTitle, margin, y, ink, accent);
    y -= 22;

    const sigW = (width - margin * 2 - 24) / 2;
    const sigH = 110;

    page.drawRectangle({ x: margin, y: y - sigH, width: sigW, height: sigH, borderColor: line, borderWidth: 1, color: rgb(1, 1, 1) });
    page.drawText(T.lenderSig, { x: margin + 10, y: y - 16, size: 9, font: helvBold, color: muted });
    page.drawText(T.lenderName, { x: margin + 10, y: y - 30, size: 9, font: helv, color: ink });

    const stampCx = margin + sigW - 42;
    const stampCy = y - sigH / 2 - 4;
    const stampR = 32;
    page.drawCircle({ x: stampCx, y: stampCy, size: stampR, borderColor: bnpparibasRed, borderWidth: 2, color: rgb(1, 1, 1) });
    page.drawCircle({ x: stampCx, y: stampCy, size: stampR - 4, borderColor: bnpparibasRed, borderWidth: 0.6, color: rgb(1, 1, 1) });
    const tw = 6;
    page.drawRectangle({ x: stampCx - tw, y: stampCy + 4, width: tw, height: 6, color: bnpparibasRed });
    page.drawRectangle({ x: stampCx, y: stampCy - 10, width: tw, height: 6, color: bnpparibasRed });
    page.drawText("BNP PARIBAS", { x: stampCx - 12, y: stampCy + 14, size: 8, font: helvBold, color: bnpparibasRed });
    page.drawText("BANK", { x: stampCx - 11, y: stampCy - 22, size: 7, font: helvBold, color: bnpparibasRed });
    page.drawText("PARIS", { x: stampCx - 11, y: stampCy - 30, size: 6, font: helv, color: bnpparibasRed });

    page.drawText(T.lenderName, { x: margin + 14, y: y - sigH + 38, size: 14, font: helvBold, color: rgb(0.05, 0.18, 0.45) });
    page.drawLine({ start: { x: margin + 14, y: y - sigH + 34 }, end: { x: margin + 130, y: y - sigH + 34 }, thickness: 1, color: rgb(0.05, 0.18, 0.45) });
    page.drawText(`${T.signedElectronically} · ` + new Intl.DateTimeFormat(LOCALE_MAP[lang], { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date()),
      { x: margin + 14, y: y - sigH + 14, size: 7, font: helv, color: muted });
    page.drawText(`${T.certificate}: ${T.certificatePrefix}` + loan.id.slice(0, 8).toUpperCase(),
      { x: margin + 14, y: y - sigH + 6, size: 6.5, font: helv, color: muted });

    page.drawRectangle({ x: margin + sigW + 24, y: y - sigH, width: sigW, height: sigH, borderColor: line, borderWidth: 1, color: rgb(1, 1, 1) });
    page.drawText(T.borrowerSig, { x: margin + sigW + 34, y: y - 16, size: 9, font: helvBold, color: muted });
    page.drawText(T.signMention, { x: margin + sigW + 34, y: y - 30, size: 8, font: helv, color: muted });
    page.drawText(loan.full_name, { x: margin + sigW + 34, y: y - sigH + 12, size: 9, font: helv, color: muted });

    page.drawLine({ start: { x: margin, y: 60 }, end: { x: width - margin, y: 60 }, thickness: 0.5, color: line });
    page.drawText(T.footer, { x: margin, y: 46, size: 8, font: helv, color: muted });
    page.drawText(`${T.page} · ${T.refPrefix} ${loan.id.slice(0, 8).toUpperCase()}`, {
      x: width - margin - 140, y: 46, size: 8, font: helv, color: muted,
    });

    const bytes = await pdf.save();
    const base64 = Buffer.from(bytes).toString("base64");

    return {
      base64,
      filename: `contrat-lendly-${loan.id.slice(0, 8)}.pdf`,
    };
  });

function drawSectionTitle(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  text: string,
  x: number,
  y: number,
  ink: ReturnType<typeof rgb>,
  accent: ReturnType<typeof rgb>,
) {
  page.drawRectangle({ x, y: y + 2, width: 3, height: 12, color: accent });
  page.drawText(text, { x: x + 10, y: y + 2, size: 11, font, color: ink });
}

function drawKV(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  fontBold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  key: string,
  value: string,
  x: number,
  y: number,
  ink: ReturnType<typeof rgb>,
  muted: ReturnType<typeof rgb>,
) {
  page.drawText(key, { x, y, size: 9, font, color: muted });
  page.drawText(value, { x: x + 140, y, size: 10, font: fontBold, color: ink });
}
