// Panel addresses never carry a person's email or name.
export const usersPath = () => "/admin/usuarios";
export const userPath = (id: string) => `${usersPath()}/${id}`;
export const assignmentPath = (id: string, assignment: number) =>
  `${userPath(id)}/roles/${assignment}`;
export const rolesPath = () => "/admin/roles";
export const rolePath = (id: number) => `${rolesPath()}/${id}`;
export function managementId(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
export function userId(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
