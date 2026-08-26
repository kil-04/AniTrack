/**
 * Minimal typed key-value store backed by a JSON file in userData.
 * Drop-in replacement for electron-store that works with CommonJS output.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export class SimpleStore<T extends Record<string, any>> {
  private data: Partial<T> = {};
  private filePath: string;

  constructor(name: string) {
    this.filePath = path.join(app.getPath("userData"), `${name}.json`);
    this.load();
  }

  private load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.data = JSON.parse(raw) as Partial<T>;
    } catch {
      this.data = {};
    }
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error("SimpleStore save error", e);
    }
  }

  get<K extends keyof T>(key: K): T[K] | undefined {
    return this.data[key] as T[K] | undefined;
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value;
    this.save();
  }

  delete<K extends keyof T>(key: K): void {
    delete this.data[key];
    this.save();
  }
}
