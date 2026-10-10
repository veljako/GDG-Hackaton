export const BRAND = {
  name: "GEvents",
  icon: "/favicon.svg?v=gevents-1",
  tagline: "Build together.",
  community: "GDG Belgrade",
};
export const STORAGE_KEY = "gevents-demo-v1";

export const organizerName = (name: string) =>
  /^(?:GDev|GHub|GEvents) Demo Community$/.test(name)
    ? `${BRAND.name} Demo Community`
    : name;
