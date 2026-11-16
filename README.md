# INVALL — Control de horas de vuelo

Aplicación web para registrar horas de vuelo individuales de pilotos de drones.

## Estado
**Fase 2: código inicial implementado, pendiente de configuración y pruebas.** No está desplegada ni lista para uso real.

## Tecnología
React + TypeScript + Vite, Supabase Auth y PostgreSQL con Row Level Security (RLS).

## Desarrollo local
1. Instalar Node.js 20.19+ o 22.12+.
2. Ejecutar `npm install`.
3. Crear un proyecto propio en Supabase.
4. Ejecutar `supabase/schema.sql` en el editor SQL de Supabase.
5. Copiar `.env.example` a `.env.local` y configurar la URL y la clave **pública** publishable/anon. Nunca añadir claves secretas.
6. Desactivar el registro público de usuarios en Supabase Auth, crear las cuentas desde el panel de administración y asignar el administrador inicial siguiendo `docs/ARQUITECTURA.md`.
7. Ejecutar `npm run dev` y probar con cuentas de piloto y administrador.

## Permisos
- Piloto: registrar y consultar sus propios vuelos.
- Administrador: consultar los vuelos de todos los pilotos.
- La base de datos impide editar perfiles o modificar/eliminar vuelos desde el cliente en esta versión.

## Archivos principales
- `src/App.tsx`: interfaz de acceso, alta de vuelo e historial.
- `src/lib/supabase.ts`: cliente de autenticación y datos.
- `supabase/schema.sql`: tablas y políticas de seguridad.
- `docs/ARQUITECTURA.md`: decisiones de diseño, flujo de tokens y tareas pendientes.
- `legacy.html`: prototipo local de fase 1.

## Publicación
Esta versión requiere compilar React (`npm run build`) y desplegar el directorio `dist/` en un hosting de aplicaciones estáticas. **GitHub Pages configurado para servir directamente la raíz del repositorio no ejecutará la aplicación React**. El repositorio actualmente es público; no almacenar datos operativos sensibles.

## Pendiente
Pruebas de compilación y RLS, recuperación de contraseña, gestión administrativa de pilotos, auditoría, informes y despliegue seguro.
