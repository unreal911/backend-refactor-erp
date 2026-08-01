import { documentStorageContract } from "./contracts/document-storage.contract";
import { secretProtectorContract } from "./contracts/secret-protector.contract";
import { InMemoryDocumentStorage } from "./fakes/in-memory-document-storage";
import { InMemorySecretProtector } from "./fakes/in-memory-secret-protector";

documentStorageContract("fake en memoria", () => {
    const storage = new InMemoryDocumentStorage();
    return {
        storage,
        tamper: (input) => storage.tamper(input),
        download: (signedUrl) => storage.download(signedUrl),
    };
});

secretProtectorContract("fake en memoria", () => ({
    secretProtector: new InMemorySecretProtector(),
}));
