// Permisos por perfil. Se aplican SIEMPRE en el servidor (server.js → route()).
const STAFF = ['staff'];
export const ROLE_PERMS = {
  admin: ['*'],
  comercial: [...STAFF, 'clients:r', 'clients:w', 'leads:r', 'leads:w', 'quotes:r', 'quotes:w', 'events:r', 'events:w',
    'catalog:r', 'providers:r', 'comms:r', 'comms:w', 'calendar:r', 'payments_in:r', 'margins:r', 'reports:r', 'ai:use', 'tasks:w'],
  operaciones: [...STAFF, 'clients:r', 'leads:r', 'quotes:r', 'events:r', 'events:w', 'ops:w', 'catalog:r', 'catalog:w',
    'providers:r', 'providers:w', 'availability:w', 'comms:r', 'comms:w', 'calendar:r', 'payments_out:r', 'reports:r',
    'tasks:w', 'documents:w'],
  finanzas: [...STAFF, 'clients:r', 'quotes:r', 'events:r', 'payments_in:r', 'payments_in:w', 'payments_out:r',
    'payments_out:w', 'documents:w', 'margins:r', 'reports:r', 'providers:r', 'calendar:r', 'comms:r'],
  proveedor: ['portal:provider'],
  cliente: ['portal:client'],
};
export const can = (user, perm) => {
  if (!user) return false;
  const p = ROLE_PERMS[user.role] || [];
  return p.includes('*') || p.includes(perm);
};
export const isStaff = (user) => can(user, 'staff');
