import { preparePendingImagesForSend } from "./preparePendingImagesForSend";
import { readFileAsBase64 } from "./chatControllerUtils";

jest.mock("./chatControllerUtils", () => ({
  readFileAsBase64: jest.fn(),
}));

describe("preparePendingImagesForSend", () => {
  const manipulateAsync = jest.requireMock("expo-image-manipulator")
    .manipulateAsync as jest.Mock;
  const mockedReadFileAsBase64 = readFileAsBase64 as jest.MockedFunction<
    typeof readFileAsBase64
  >;

  beforeEach(() => {
    mockedReadFileAsBase64.mockReset();
    manipulateAsync.mockReset();
  });

  it("compresses jpeg images before sending", async () => {
    manipulateAsync.mockImplementation(
      async (_uri: string, _actions: unknown, saveOptions?: { format?: string }) => ({
        uri: "file://compressed.jpg",
        width: 1600,
        height: 1200,
        base64:
          saveOptions?.format === "png"
            ? "png"
            : "a".repeat(512),
      }),
    );

    const result = await preparePendingImagesForSend([
      {
        uri: "file://original.jpg",
        base64: "b".repeat(4096),
        mimeType: "image/jpeg",
        width: 4032,
        height: 3024,
      },
    ]);

    expect(result.changed).toBe(true);
    expect(result.images[0]).toMatchObject({
      uri: "file://compressed.jpg",
      mimeType: "image/jpeg",
      width: 1600,
      height: 1200,
    });
    expect(result.images[0].base64).toHaveLength(512);
  });

  it("keeps png output when the resized png is already small enough", async () => {
    manipulateAsync.mockImplementation(
      async (_uri: string, _actions: unknown, saveOptions?: { format?: string }) => ({
        uri:
          saveOptions?.format === "png"
            ? "file://resized.png"
            : "file://compressed.jpg",
        width: 1200,
        height: 900,
        base64:
          saveOptions?.format === "png"
            ? "p".repeat(1024)
            : "j".repeat(2048),
      }),
    );

    const result = await preparePendingImagesForSend([
      {
        uri: "file://original.png",
        base64: "x".repeat(8192),
        mimeType: "image/png",
        width: 2400,
        height: 1800,
      },
    ]);

    expect(result.images[0]).toMatchObject({
      uri: "file://resized.png",
      mimeType: "image/png",
    });
  });

  it("does not recompress gif images and only backfills missing base64", async () => {
    mockedReadFileAsBase64.mockResolvedValue("gif-base64");

    const result = await preparePendingImagesForSend([
      {
        uri: "file://anim.gif",
        base64: "",
        mimeType: "image/gif",
      },
    ]);

    expect(manipulateAsync).not.toHaveBeenCalled();
    expect(mockedReadFileAsBase64).toHaveBeenCalledWith("file://anim.gif");
    expect(result.images[0]).toMatchObject({
      uri: "file://anim.gif",
      mimeType: "image/gif",
      base64: "gif-base64",
    });
  });

  it("reads missing base64 for shared file attachments without touching image compression", async () => {
    mockedReadFileAsBase64.mockResolvedValue("file-base64");

    const result = await preparePendingImagesForSend([
      {
        uri: "file://shared.pdf",
        base64: "",
        mimeType: "application/pdf",
      },
    ]);

    expect(manipulateAsync).not.toHaveBeenCalled();
    expect(result.images[0]).toMatchObject({
      uri: "file://shared.pdf",
      mimeType: "application/pdf",
      base64: "file-base64",
    });
  });
});
