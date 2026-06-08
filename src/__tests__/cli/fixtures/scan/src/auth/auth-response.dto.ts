export class LoginResponseDto {
  accessToken: string;
  refreshToken: string;
}

export class RegisterResponseDto {
  message: string;
  userId: string;
}

export class UserDto {
  id: string;
  email: string;
  name: string;
}
