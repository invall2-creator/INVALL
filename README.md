# UDRON · Control de vols

Llibre de vols per als pilots de drons de la unitat. És una aplicació web que s'obre des del navegador o s'instal·la al mòbil, amb usuari i contrasenya.

Adreça: https://invall2-creator.github.io/INVALL/

## Què fa
- **Accés:** cada pilot sol·licita el compte a la pantalla d'inici i confirma el correu. Després, l'administració l'autoritza a la pestanya *Equip*. També es pot recuperar la contrasenya.
- **Registra un vol:** data, hores d'enlairament i aterratge (la durada es calcula sola), aeronau, lloc, tipus de servei, categoria d'operació, dia o nit, funció, enlairaments, incidències i observacions. Si es tanca la pàgina a mig omplir, el formulari es recupera.
- **Tauler:** hores totals, d'aquest any, dels últims 90 dies i nocturnes, un gràfic mensual, hores per aeronau i per servei, i si el pilot està al dia de pràctica.
- **Historial:** filtres per període, pilot, aeronau i servei, i un cercador. Els vols s'editen indicant un motiu, i el canvi queda al registre. Els vols eliminats no es perden: l'administració els pot recuperar. Exportació a Excel.
- **Equip** (administració): sol·licituds pendents, hores de cada pilot, nomenar administradors i bloquejar l'accés.
- **Flota:** número de sèrie, classe, estat i control de les hores que falten per a la propera revisió.

## Posada en marxa
1. **Base de dades.** Al Supabase, a *SQL Editor*, executa per ordre els fitxers de `supabase/migrations/` que encara no s'hagin aplicat. L'últim és `20261122_udron_v3.sql`: només afegeix taules, columnes i funcions i no esborra cap dada.
2. **Recuperació de contrasenya.** A Supabase, ves a *Authentication → URL Configuration* i afegeix `https://invall2-creator.github.io/INVALL/` a *Site URL* i a *Redirect URLs*.
3. **Publicació automàtica.** Al GitHub, ves a *Settings → Secrets and variables → Actions* i crea els secrets `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY`. Fes servir la clau pública *publishable/anon*, mai la *service_role*. A partir d'aquí, cada canvi a `main` es publica sol a la branca `gh-pages`. A *Settings → Pages*, la font ha de ser la branca `gh-pages`.
4. **Primer administrador.** Si encara no n'hi ha cap, executa a *SQL Editor*:
   `update public.profiles set role = 'admin', approval_status = 'approved' where id = 'UUID_DE_L_USUARI';`
   Els següents administradors es poden nomenar des de la pestanya *Equip*.

## Desenvolupament local
Cal Node.js 20.19+ o 22.12+.
1. Executa `npm install`.
2. Copia `.env.example` a `.env.local` i posa-hi la URL i la clau pública de Supabase.
3. Executa `npm run dev`.

## Seguretat
- Els permisos els aplica la base de dades amb Row Level Security, no el navegador. Cada pilot només veu i modifica els seus vols. L'administració ho veu tot, inclosos els vols eliminats.
- El registre de canvis (`flight_changes`) només s'escriu des de les funcions del servidor. Ningú no el pot modificar des de l'app.
- El repositori és públic: no hi pugis mai claus secretes ni dades personals.

## Fitxers principals
- `src/App.tsx`: accés, navegació i càrrega de dades.
- `src/views/`: Tauler, Registra, Historial, Equip i Flota.
- `src/flight-export.ts`: exportació a Excel.
- `supabase/migrations/`: canvis de base de dades, per ordre.
- `.github/workflows/deploy.yml`: publicació automàtica.
