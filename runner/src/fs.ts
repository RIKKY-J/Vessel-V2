import fs from "fs";
import path from "path";

interface File {
    type: "file" | "dir";
    name: string;
    path: string;
}

export const fetchDir = (dir: string, baseDir: string): Promise<File[]> => {
    return new Promise((resolve) => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch {}
            return resolve([]);
        }

        fs.readdir(dir, { withFileTypes: true }, (err, files) => {
            if (err) {
                console.warn(`[fs] fetchDir warning for ${dir}:`, err.message);
                return resolve([]);
            }

            resolve(
                files
                    .filter((file) => file.name !== "node_modules" && file.name !== ".git" && file.name !== ".cache")
                    .map((file) => ({
                        type: file.isDirectory() ? "dir" : "file",
                        name: file.name,
                        path: `${baseDir ? baseDir + "/" : ""}${file.name}`,
                    }))
            );
        });
    });
};

export const fetchFileContent = (file: string): Promise<string> => {
    return new Promise((resolve) => {
        if (!fs.existsSync(file)) {
            return resolve("");
        }

        fs.readFile(file, "utf8", (err, data) => {
            if (err) {
                console.warn(`[fs] fetchFileContent warning for ${file}:`, err.message);
                return resolve("");
            }
            resolve(data);
        });
    });
};

export const saveFile = async (file: string, content: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch {}
        }

        fs.writeFile(file, content, "utf8", (err) => {
            if (err) {
                console.warn(`[fs] saveFile warning for ${file}:`, err.message);
                return reject(err);
            }
            resolve();
        });
    });
};