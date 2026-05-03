import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Refrigerator } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const [, navigate] = useLocation();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-black flex flex-col items-center justify-center px-4 py-12">
      {/* Brand */}
      <div className="text-center mb-10">
        <div className="flex items-center justify-center mb-5">
          <Refrigerator className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-5xl sm:text-6xl font-display font-bold text-white tracking-tight leading-none">
          MonFrigo
        </h1>
        <p className="text-zinc-500 mt-4 text-[11px] tracking-[0.25em] uppercase">
          Moins gaspiller · Mieux manger · Économiser
        </p>
      </div>

      {/* Form */}
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 backdrop-blur-sm">
          <h2 className="text-white font-semibold text-lg mb-1">Bon retour !</h2>
          <p className="text-zinc-500 text-sm mb-7">Connectez-vous à votre compte</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-zinc-400 text-[11px] font-medium uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="vous@exemple.com"
                className="w-full bg-zinc-800/60 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60
                  placeholder:text-zinc-600 transition-all"
              />
            </div>

            <div>
              <label className="block text-zinc-400 text-[11px] font-medium uppercase tracking-wider mb-1.5">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-zinc-800/60 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60
                  placeholder:text-zinc-600 transition-all"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-black font-semibold py-3 rounded-xl text-sm
                hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed
                transition-all mt-1"
            >
              {loading ? "Connexion en cours…" : "Se connecter"}
            </button>
          </form>

          <p className="text-zinc-600 text-sm text-center mt-6">
            Pas encore de compte?{" "}
            <Link
              href="/sign-up"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Créer un compte
            </Link>
          </p>
        </div>

        <p className="text-zinc-700 text-[11px] text-center mt-5 leading-relaxed">
          En continuant, vous acceptez nos{" "}
          <Link href="/terms" className="text-zinc-500 hover:text-zinc-400 underline">
            conditions d'utilisation
          </Link>{" "}
          et notre{" "}
          <Link href="/privacy" className="text-zinc-500 hover:text-zinc-400 underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
