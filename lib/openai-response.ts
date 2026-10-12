export function responseOutputText(payload: unknown) {
  const value = payload as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  return (value.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("");
}

export function bytesToDataUrl(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return `data:${file.type};base64,${btoa(binary)}`;
  });
}

