import { Link } from "wouter";
import { FileText, ArrowLeft, AlertTriangle, Mail } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-background px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Link href="/sign-in" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour à la connexion
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conditions d'utilisation</h1>
            <p className="text-sm text-muted-foreground">Dernière mise à jour : mai 2025</p>
          </div>
        </div>

        <div className="mb-8 p-4 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
            <strong>Avis important :</strong> Les recommandations alimentaires générées par MonFrigo sont fournies à titre informatif seulement et ne constituent pas des conseils médicaux, nutritionnels ou diététiques professionnels. Consultez un professionnel de la santé pour tout besoin médical ou nutritionnel spécifique.
          </p>
        </div>

        <div className="space-y-8 text-sm">

          <Section title="1. Acceptation des conditions">
            <p className="text-muted-foreground">
              En utilisant MonFrigo, vous acceptez ces Conditions d'utilisation dans leur intégralité. Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser le service.
            </p>
          </Section>

          <Section title="2. Description du service">
            <p className="text-muted-foreground">
              MonFrigo est une application web de planification de repas assistée par intelligence artificielle. Le service permet de :
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
              <li>Générer des menus hebdomadaires personnalisés basés sur le contenu de votre frigo et vos préférences</li>
              <li>Produire une liste d'épicerie associée</li>
              <li>Identifier des épiceries proches (avec votre consentement de géolocalisation)</li>
            </ul>
          </Section>

          <Section title="3. Avis sur les recommandations alimentaires">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
              <p className="text-muted-foreground leading-relaxed">
                Les menus et recettes générés par MonFrigo sont produits par un modèle d'intelligence artificielle à titre <strong>indicatif et informatif uniquement</strong>. Ils ne remplacent pas les conseils d'un diététiste, nutritionniste ou médecin. MonFrigo ne garantit pas :
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                <li>L'exactitude des valeurs nutritionnelles</li>
                <li>L'absence d'allergènes non identifiés</li>
                <li>L'adéquation du menu pour des conditions médicales spécifiques</li>
                <li>La convenance pour des régimes thérapeutiques prescrits</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Si vous avez des allergies alimentaires graves, des intolérances ou une condition médicale nécessitant un régime particulier, consultez un professionnel de la santé avant de suivre les recommandations de MonFrigo.
              </p>
            </div>
          </Section>

          <Section title="4. Avis sur les prix et estimations">
            <p className="text-muted-foreground">
              Les prix affichés dans la liste d'épicerie et les estimations de coût des épiceries sont des <strong>estimations indicatives</strong> uniquement. Ils sont calculés par algorithme et peuvent différer significativement des prix réels en magasin. MonFrigo ne garantit pas l'exactitude des prix affichés et décline toute responsabilité quant aux décisions d'achat basées sur ces estimations.
            </p>
          </Section>

          <Section title="5. Utilisation acceptable">
            <p className="text-muted-foreground mb-2">Vous vous engagez à :</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Utiliser MonFrigo uniquement à des fins personnelles et non commerciales</li>
              <li>Ne pas tenter de contourner les mesures de sécurité ou les limites du service</li>
              <li>Ne pas soumettre de contenu offensant, illégal ou trompeur</li>
              <li>Maintenir la confidentialité de vos identifiants de connexion</li>
            </ul>
          </Section>

          <Section title="6. Compte et abonnement">
            <p className="text-muted-foreground mb-2">
              <strong>Plan gratuit :</strong> 2 générations de menu gratuites par compte.
            </p>
            <p className="text-muted-foreground mb-2">
              <strong>Plan Premium :</strong> 10,00 $ CAD par mois, annulable à tout moment. L'accès Premium reste actif jusqu'à la fin de la période payée.
            </p>
            <p className="text-muted-foreground">
              Les paiements sont traités par Stripe. MonFrigo n'accède jamais à vos informations bancaires. Les remboursements sont examinés au cas par cas — écrivez-nous à{" "}
              <a href="mailto:support@monfrigo.ca" className="text-primary underline">support@monfrigo.ca</a>.
            </p>
          </Section>

          <Section title="7. Propriété intellectuelle">
            <p className="text-muted-foreground">
              L'interface, le design, le code et la marque MonFrigo sont protégés. Les recettes générées par IA sont fournies à usage personnel uniquement et ne peuvent être revendues ou redistribuées commercialement.
            </p>
          </Section>

          <Section title="8. Limitation de responsabilité">
            <p className="text-muted-foreground">
              Dans les limites permises par la loi, MonFrigo ne sera pas responsable des dommages directs, indirects, accessoires ou consécutifs découlant de l'utilisation du service, incluant notamment des réactions allergiques, des décisions d'achat ou des pertes financières basées sur les estimations de prix.
            </p>
          </Section>

          <Section title="9. Résiliation">
            <p className="text-muted-foreground">
              Vous pouvez supprimer votre compte à tout moment depuis la section Préférences ou en contactant{" "}
              <a href="mailto:support@monfrigo.ca" className="text-primary underline">support@monfrigo.ca</a>.
              Nous nous réservons le droit de suspendre un compte en cas d'abus.
            </p>
          </Section>

          <Section title="10. Modifications du service">
            <p className="text-muted-foreground">
              MonFrigo se réserve le droit de modifier, suspendre ou interrompre tout ou partie du service avec un préavis raisonnable. Toute modification importante des présentes conditions vous sera communiquée au moins 30 jours à l'avance.
            </p>
          </Section>

          <Section title="11. Droit applicable">
            <p className="text-muted-foreground">
              Ces conditions sont régies par les lois de la province de Québec, Canada.
            </p>
          </Section>

          <Section title="12. Nous contacter">
            <div className="space-y-1 text-muted-foreground">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                <span>Support : </span>
                <a href="mailto:support@monfrigo.ca" className="text-primary underline">support@monfrigo.ca</a>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                <span>Confidentialité : </span>
                <a href="mailto:privacy@monfrigo.ca" className="text-primary underline">privacy@monfrigo.ca</a>
              </div>
            </div>
          </Section>

        </div>

        <div className="mt-10 pt-6 border-t border-border/50 flex gap-4 text-sm text-muted-foreground">
          <Link href="/privacy" className="text-primary hover:underline">Politique de confidentialité</Link>
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
      <div className="space-y-2">{children}</div>
    </section>
  );
}
