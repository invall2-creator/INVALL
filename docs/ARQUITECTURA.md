# Fase 2: arquitectura y seguridad

## Modelo
- Un vuelo pertenece exactamente a un piloto mediante `pilot_id`.
- `profiles` contiene el nombre y el rol (pilot/admin).
- `flights` contiene fecha, aeronave, duración en minutos y notas.
- El administrador puede consultar todos los vuelos; cada piloto solo los suyos.

## Flujo de autenticación
1. El piloto introduce correo y contraseña en el navegador.
2. Supabase Auth verifica las credenciales y emite una sesión.
3. El cliente Supabase adjunta el token de acceso a las solicitudes.
4. PostgreSQL aplica políticas RLS usando `auth.uid()` y el rol consultado en la base de datos.
5. La renovación y el cierre de sesión se gestionan mediante Supabase Auth.

## Tratamiento de secretos
- `VITE_SUPABASE_URL` y la clave pública **publishable/anon** son configuración visible en el navegador, no secretos.
- Nunca incluir `service_role`, claves secretas, contraseñas, tokens de acceso ni `.env.local` en Git.
- No guardar contraseñas en tablas de aplicación.
- Supabase Auth gestiona la verificación y almacenamiento seguro de credenciales.
- La sesión de navegador de supabase-js usa almacenamiento persistente por defecto; considerar medidas adicionales contra XSS, CSP y sesiones compartidas antes de producción.

## Provisionamiento inicial
- Desactivar nuevas inscripciones públicas en Supabase Auth.
- Crear cuentas de pilotos desde el panel de Supabase Auth o mediante backend administrativo seguro.
- La función trigger crea perfiles con rol `pilot` por defecto.
- Para nombrar un administrador inicial, ejecutar en SQL Editor con privilegios administrativos:
  `update public.profiles set role = 'admin' where id = 'UUID_REAL_DEL_USUARIO';`
- Nunca aceptar roles de los metadatos editables del usuario.

## Estado y límites
- Scaffold funcional sujeto a configurar Supabase y desplegar el frontend.
- El prototipo anterior permanece en `index.html`; `app.html` es la entrada React de esta fase.
- Falta panel de alta de pilotos, edición auditada, informes, pruebas de seguridad y despliegue.
- No almacenar datos operativos sensibles ni personales reales hasta revisar protección de datos, acceso y alojamiento.
