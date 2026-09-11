import React from 'react';

export type PastedFile = {
  fileName: string;
  fileSize: number;
  type: string;
  uri: string;
};

const PasteInput = React.forwardRef<unknown, Record<string, unknown>>(
  function PasteInput(props, ref) {
    return React.createElement('PasteInput', { ...props, ref });
  },
);

export default PasteInput;
