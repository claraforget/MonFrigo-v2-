import { Link } from "wouter";
import { Shield, ArrowLeft, Mail } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-background px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Link href="/sign-in" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour à la connexion
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Politique de confidentialité</h1>
            <p className="text-sm text-muted-foreground">Dernière mise à jour : mai 2025</p>
          </div>
        </div>

        <div className="prose prose-sm max-w-none text-foreground space-y-8">

          <section>
            <p className="text-muted-foreground leading-relaxed">
              MonFrigo (« nous », « notre ») s'engage à protéger vos renseignements personnels conformément à la{" "}
              <strong>Loi modernisant des dispositions législatives en matière de protection des renseignements personnels (Loi 25)</strong>{" "}
              du Québec et à la <strong>Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE / PIPEDA)</strong>.
            </p>
          </section>

          <Section title="1. Responsable de la protection des renseignements personnels">
            <p>
              La personne responsable de la protection des renseignements personnels peut être jointe à :{" "}
              <a href="mailto:privacy@monfrigo.ca" className="text-primary underline">privacy@monfrigo.ca</a>
            </p>
          </Section>

          <Section title="2. Renseignements personnels collectés">
            <p>Nous collectons les informations suivantes :</p>
            <Table rows={[
              ["Adresse courriel", "Création de compte et authentification", "Clerk (fournisseur tiers)"],
              ["Nom (optionnel)", "Personnalisation de l'interface", "Clerk"],
              ["Contenu de votre frigo", "Génération de menus personnalisés", "Notre base de données (Neon)"],
              ["Préférences alimentaires", "Personnalisation des menus (allergies, régime, budget)", "Notre base de données"],
              ["Historique des menus générés", "Affichage de vos menus passés", "Notre base de données"],
              ["Localisation géographique (optionnelle)", "Trouver les épiceries proches de vous", "Utilisée en temps réel, non conservée"],
              ["Informations de paiement", "Traitement des abonnements", "Stripe (aucune carte conservée par MonFrigo)"],
            ]} headers={["Donnée", "Finalité", "Traitement"]} />
            <p className="mt-4 text-muted-foreground text-sm">
              <strong>Données sensibles :</strong> vos préférences alimentaires (allergies, régimes) peuvent être considérées comme des informations de santé. Elles sont traitées avec un niveau de sécurité renforcé et ne sont jamais partagées à des fins commerciales.
            </p>
          </Section>

          <Section title="3. Utilisation des renseignements">
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Générer votre menu hebdomadaire personnalisé</li>
              <li>Produire votre liste d'épicerie</li>
              <li>Vous suggérer des épiceries proches (si vous autorisez la géolocalisation)</li>
              <li>Gérer votre compte et votre abonnement</li>
              <li>Améliorer le service (données agrégées et anonymisées uniquement)</li>
            </ul>
            <p className="mt-3 text-muted-foreground">
              Vos données ne sont <strong>jamais vendues</strong> à des tiers, ni utilisées à des fins publicitaires.
            </p>
          </Section>

          <Section title="4. Sous-traitants et tiers">
            <p className="text-muted-foreground mb-3">Nous faisons appel aux fournisseurs suivants, chacun disposant de sa propre politique de confidentialité :</p>
            <Table rows={[
              ["Clerk", "Authentification des utilisateurs", "États-Unis", "clerk.com/privacy"],
              ["Stripe", "Traitement des paiements", "États-Unis", "stripe.com/privacy"],
              ["Neon", "Base de données PostgreSQL", "États-Unis", "neon.tech/privacy"],
              ["Groq", "Génération IA des menus (votre frigo et préférences sont envoyés)", "États-Unis", "groq.com/privacy"],
            ]} headers={["Fournisseur", "Rôle", "Lieu", "Politique"]} />
            <p className="mt-3 text-sm text-muted-foreground">
              <strong>Note importante :</strong> lors de la génération d'un menu, le contenu de votre frigo et vos préférences sont transmis à Groq pour traitement IA. Aucun identifiant personnel n'est transmis.
            </p>
          </Section>

          <Section title="5. Témoins (cookies) et stockage local">
            <p className="text-muted-foreground">MonFrigo utilise :</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
              <li><strong>Cookies de session Clerk</strong> — indispensables au maintien de votre connexion</li>
              <li><strong>Stockage local (localStorage)</strong> — pour mémoriser vos préférences d'interface et votre consentement aux cookies</li>
              <li><strong>Cookies Stripe</strong> — lors du processus de paiement uniquement</li>
            </ul>
            <p className="mt-3 text-muted-foreground">Aucun cookie publicitaire ou de traçage n'est utilisé.</p>
          </Section>

          <Section title="6. Géolocalisation">
            <p className="text-muted-foreground">
              La géolocalisation est <strong>facultative</strong> et n'est activée que si vous cliquez explicitement sur le bouton « Autoriser la géolocalisation » dans la page Liste &amp; Épiceries. Vos coordonnées sont utilisées uniquement en temps réel pour identifier les épiceries proches et ne sont <strong>jamais conservées</strong> sur nos serveurs.
            </p>
          </Section>

          <Section title="7. Vos droits (Loi 25 / PIPEDA)">
            <p className="text-muted-foreground mb-3">Vous avez le droit de :</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong>Accéder</strong> à vos renseignements personnels</li>
              <li><strong>Rectifier</strong> des informations inexactes</li>
              <li><strong>Supprimer</strong> votre compte et toutes vos données</li>
              <li><strong>Retirer votre consentement</strong> à tout moment</li>
              <li><strong>Portabilité</strong> de vos données dans un format structuré</li>
            </ul>
            <p className="mt-3 text-muted-foreground">
              Pour exercer ces droits, écrivez-nous à{" "}
              <a href="mailto:privacy@monfrigo.ca" className="text-primary underline">privacy@monfrigo.ca</a>.
              Nous répondrons dans un délai de 30 jours.
            </p>
          </Section>

          <Section title="8. Sécurité">
            <p className="text-muted-foreground">
              Toutes les communications sont chiffrées via HTTPS/TLS. Les mots de passe ne sont jamais stockés par MonFrigo (gérés par Clerk). En cas de violation de données présentant un risque sérieux, vous serez informé et la Commission d'accès à l'information du Québec sera notifiée dans les 72 heures, conformément à la Loi 25.
            </p>
          </Section>

          <Section title="9. Conservation des données">
            <p className="text-muted-foreground">
              Vos données sont conservées tant que votre compte est actif. Après suppression de votre compte, l'ensemble des données personnelles est effacé dans un délai de 30 jours, sauf obligation légale contraire.
            </p>
          </Section>

          <Section title="10. Modifications de cette politique">
            <p className="text-muted-foreground">
              Toute modification importante vous sera communiquée par courriel ou via un avis dans l'application au moins 30 jours avant son entrée en vigueur.
            </p>
          </Section>

          <Section title="11. Nous contacter">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-4 h-4 text-primary" />
              <a href="mailto:privacy@monfrigo.ca" className="text-primary underline">privacy@monfrigo.ca</a>
            </div>
          </Section>

        </div>

        <div className="mt-10 pt-6 border-t border-border/50 flex gap-4 text-sm text-muted-foreground">
          <Link href="/terms" className="text-primary hover:underline">Conditions d'utilisation</Link>
          <Link href="/sign-in" className="hover:text-foreground transition-colors">Retour à la connexion</Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-foreground mb-3 border-b border-border/50 pb-2">{title}</h2>
      <div className="text-sm space-y-2">{children}</div>
    </section>
  );
}

function Table({ rows, headers }: { rows: string[][]; headers: string[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/50 mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 font-semibold text-foreground/80 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-muted-foreground align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
