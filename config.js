// Configuration Supabase (classement des explorateurs).
// La clé "anon" est publique par conception : la sécurité repose sur les règles RLS (voir supabase/schema.sql).
// Tant que ces valeurs ne sont pas remplies, le classement reste local au navigateur.
window.GAME_CONFIG = {
  SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
  SUPABASE_ANON_KEY: "VOTRE_CLE_ANON_PUBLIQUE"
};
