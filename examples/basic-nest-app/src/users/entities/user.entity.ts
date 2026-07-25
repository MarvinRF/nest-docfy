export enum UserRole {
  Member = 'member',
  Admin = 'admin',
}

export class UserEntity {
  id: string;
  name: string;
  role: UserRole;
}

/**
 * A distinct shape returned only for admin users. `findOne()`'s return type
 * (`Promise<UserEntity | AdminUserEntity>`) is a union of two named classes —
 * patch-spec/the CLI plugin resolve each union branch independently and turn
 * it into a `oneOf` schema automatically, with zero manual `schema:`/`type:`
 * needed in the docs file.
 */
export class AdminUserEntity extends UserEntity {
  permissions: string[];
}
