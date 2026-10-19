const PDFDocument = require('pdfkit');
const Pays = require('../models/Pays');
const ApiError = require('../utils/ApiError');
const livraisonService = require('./livraison.service');

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const NOIR = '#222222';
const GRIS = '#777777';
const BRUN = '#97643E';
const FILET = '#D8C7B0';

const nombre = (v) => Number(String(v === undefined || v === null || v === '' ? 0 : v)) || 0;
// Espaces ordinaires comme séparateur de milliers : l'espace insécable fine de
// Intl n'existe pas dans la police PDF de base.
const montant = (v) => Math.round(nombre(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function jourLong(jour) {
  const t = new Date(`${jour}T12:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Une ligne de la fiche à partir d'une livraison formatée (voir livraison.service.formater). */
function ligneFiche(l, symbole) {
  const c = l.commande;
  const client = c.client || {};
  const net = nombre(c.total) - nombre(c.reduction);
  const reste = nombre(c.reste_a_payer);
  const fraisDus = nombre(c.frais_livraison_du);
  const fraisStandard = nombre(c.frais_livraison_standard);
  const aPercevoir = reste + fraisDus;
  const articles = (c.lignes || []).map((p) => {
    const base = [p.produit, p.couleur, p.detail ? `(${p.detail})` : '', p.quantite > 1 ? `x${p.quantite}` : ''].filter(Boolean).join(' ');
    return p.personnalisation ? `${base} — « ${p.personnalisation} »` : base;
  });
  const telephones = String(client.telephone_whatsapp || '').split(/[/,;]/).map((t) => t.trim()).filter(Boolean);
  return {
    numero: c.numero,
    client: client.nom || 'Client sans nom',
    telephone: telephones.join('\n'),
    adresse: client.adresse || '—',
    articles: articles.join('\n') || '—',
    prixBijou: `${montant(net)}`,
    reste: reste > 0 ? montant(reste) : 'Payé',
    livraison: fraisDus > 0 ? montant(fraisDus) : (fraisStandard > 0 ? 'Payée' : '—'),
    aPercevoir: aPercevoir > 0 ? montant(aPercevoir) : '0',
    aPercevoirNum: aPercevoir,
    symbole,
  };
}

const COLONNES = [
  { cle: 'rang', titre: '#', largeur: 22, align: 'center' },
  { cle: 'numero', titre: 'Commande', largeur: 78 },
  { cle: 'client', titre: 'Client / Téléphone', largeur: 112 },
  { cle: 'adresse', titre: 'Adresse de livraison', largeur: 130 },
  { cle: 'articles', titre: 'Bijou(x)', largeur: 130 },
  { cle: 'prixBijou', titre: 'Prix du\nbijou', largeur: 52, align: 'right' },
  { cle: 'reste', titre: 'Reste à\npayer', largeur: 52, align: 'right' },
  { cle: 'livraison', titre: 'Livraison', largeur: 48, align: 'right' },
  { cle: 'aPercevoir', titre: 'À percevoir', largeur: 56, align: 'right', gras: true },
  { cle: 'emargement', titre: 'Livré /\nReçu', largeur: 74 },
];

/**
 * Fiche de livraison d'une journée (retour du 19/10/2026) : PDF A4 paysage à
 * remettre au livreur — une ligne par colis avec client, téléphone, adresse,
 * bijou(x), prix du bijou, reste à payer, frais de livraison et le total à
 * percevoir, plus une colonne vide à cocher/signer. Les colis déjà livrés ne
 * figurent pas (ils n'ont plus rien à faire sur la tournée).
 */
async function genererFiche({ jour, pays_id }) {
  if (!FORMAT_JOUR.test(String(jour || ''))) throw ApiError.badRequest('Jour invalide (format attendu : AAAA-MM-JJ)');
  if (!pays_id) throw ApiError.badRequest('Choisissez un pays pour générer la fiche de livraison');

  const pays = await Pays.findById(pays_id).populate('devise_locale_id', 'code symbole');
  if (!pays) throw ApiError.notFound('Pays introuvable');
  const symbole = pays.devise_locale_id ? pays.devise_locale_id.symbole || pays.devise_locale_id.code : '';

  const livraisons = await livraisonService.lister({ du: jour, au: jour, pays_id });
  const aLivrer = livraisons.filter((l) => l.commande && !l.livree);
  if (aLivrer.length === 0) throw ApiError.notFound('Aucune livraison à effectuer ce jour-là pour ce pays');

  const lignes = aLivrer.map((l, i) => ({ rang: String(i + 1), ...ligneFiche(l, symbole), emargement: '' }));
  const totalAPercevoir = lignes.reduce((s, l) => s + l.aPercevoirNum, 0);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, info: { Title: `Fiche de livraison ${jour}`, Author: 'SANAA' } });
  const morceaux = [];
  doc.on('data', (m) => morceaux.push(m));
  const fini = new Promise((resolve) => doc.on('end', resolve));

  const gauche = doc.page.margins.left;
  const largeurTotale = COLONNES.reduce((s, c) => s + c.largeur, 0);
  const bas = () => doc.page.height - doc.page.margins.bottom - 24;
  const PADDING = 4;

  function enteteDocument() {
    doc.fillColor(BRUN).font('Helvetica-Bold').fontSize(18).text('SANAA', gauche, 28, { continued: true });
    doc.fillColor(NOIR).font('Helvetica').fontSize(12).text(`   Fiche de livraison — ${pays.nom}`);
    doc.fillColor(GRIS).fontSize(10).text(`${jourLong(jour)}  ·  ${lignes.length} colis  ·  Total à percevoir : ${montant(totalAPercevoir)} ${symbole}`, gauche, 50);
    return 70;
  }

  function enteteTableau(y) {
    doc.save().rect(gauche, y, largeurTotale, 26).fill(BRUN).restore();
    let x = gauche;
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    for (const col of COLONNES) {
      doc.text(col.titre, x + PADDING, y + 4, { width: col.largeur - 2 * PADDING, align: col.align || 'left', lineBreak: false });
      x += col.largeur;
    }
    return y + 26;
  }

  function hauteurLigne(l) {
    doc.font('Helvetica').fontSize(8.5);
    let h = 0;
    for (const col of COLONNES) {
      const texte = col.cle === 'client' ? `${l.client}\n${l.telephone}` : String(l[col.cle] || '');
      h = Math.max(h, doc.heightOfString(texte, { width: col.largeur - 2 * PADDING }));
    }
    return Math.max(h + 2 * PADDING, 34);
  }

  function dessinerLigne(l, y, h, pair) {
    if (pair) doc.save().rect(gauche, y, largeurTotale, h).fill('#FAF6F0').restore();
    let x = gauche;
    for (const col of COLONNES) {
      const opts = { width: col.largeur - 2 * PADDING, align: col.align || 'left' };
      if (col.cle === 'client') {
        doc.fillColor(NOIR).font('Helvetica-Bold').fontSize(8.5).text(l.client, x + PADDING, y + PADDING, opts);
        doc.fillColor(NOIR).font('Helvetica').fontSize(9).text(l.telephone, x + PADDING, doc.y, opts);
      } else if (col.cle === 'emargement') {
        doc.save().lineWidth(0.6).strokeColor(GRIS).rect(x + PADDING, y + PADDING + 2, 11, 11).stroke().restore();
        doc.save().lineWidth(0.4).strokeColor(FILET).moveTo(x + PADDING, y + h - PADDING - 4).lineTo(x + col.largeur - PADDING, y + h - PADDING - 4).stroke().restore();
      } else {
        doc.fillColor(NOIR).font(col.gras || col.cle === 'numero' ? 'Helvetica-Bold' : 'Helvetica').fontSize(col.cle === 'numero' ? 8.5 : 8.5)
          .text(String(l[col.cle] || ''), x + PADDING, y + PADDING, opts);
      }
      x += col.largeur;
    }
    doc.save().lineWidth(0.4).strokeColor(FILET).moveTo(gauche, y + h).lineTo(gauche + largeurTotale, y + h).stroke().restore();
  }

  let y = enteteDocument();
  y = enteteTableau(y);
  lignes.forEach((l, i) => {
    const h = hauteurLigne(l);
    if (y + h > bas()) {
      doc.addPage();
      y = enteteTableau(30);
    }
    dessinerLigne(l, y, h, i % 2 === 1);
    y += h;
  });

  // Total
  if (y + 40 > bas()) { doc.addPage(); y = 30; }
  y += 10;
  doc.fillColor(NOIR).font('Helvetica-Bold').fontSize(11)
    .text(`Total à percevoir sur la journée : ${montant(totalAPercevoir)} ${symbole}`, gauche, y, { width: largeurTotale, align: 'right' });
  doc.fillColor(GRIS).font('Helvetica').fontSize(8)
    .text('« À percevoir » = reste à payer sur le bijou + frais de livraison (hors frais déjà réglés d\'avance). « Payé » / « Payée » : rien à demander au client.', gauche, doc.y + 4, { width: largeurTotale, align: 'right' });

  doc.end();
  await fini;
  return { buffer: Buffer.concat(morceaux), nomFichier: `fiche-livraison-${jour}-${pays.code}.pdf` };
}

module.exports = { genererFiche };
