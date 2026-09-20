/** The model every fixture in this directory builds a form for. */
export interface Credentials {
  email: string;
  password: string;
}

export interface Profile {
  name: string;
  address: { city: string; postcode: string };
  tags: string[];
}
