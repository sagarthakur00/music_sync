import { useRef, useState, type DragEvent } from "react";
import type { RoomHook } from "../sync/useRoom";
import { UploadIcon } from "./Icons";

type Props = { rh: RoomHook };

export default function Uploader({ rh }: Props) {
  const { actions, canControl } = rh;
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = actions.uploading;

  if (!canControl) return null;

  const onDragOver = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLButtonElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading || e.dataTransfer.files.length === 0) return;
    void actions.upload(e.dataTransfer.files);
  };

  return (
    <div className="card uploader">
      <div className="card-head">
        <h2>Add music</h2>
      </div>
      <button
        type="button"
        className={`dropzone${dragOver ? " is-over" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        disabled={uploading}
        aria-label="Upload songs. Drag audio files here or click to choose."
      >
        {uploading ? <span className="spinner" aria-hidden="true" /> : <UploadIcon size={24} />}
        <span className="dropzone-title">{uploading ? "Uploading…" : "Drop audio files here"}</span>
        <span className="dropzone-sub">{uploading ? "Hang tight" : "or click to browse"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length) void actions.upload(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
