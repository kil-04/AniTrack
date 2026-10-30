// Vite turns imported images into URLs.
declare module "*.png" {
  const src: string;
  export default src;
}
