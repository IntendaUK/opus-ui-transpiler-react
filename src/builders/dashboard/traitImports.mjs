let traitImports = [];

export const resetTraitImports = () => {
	traitImports = [];
};

export const pushToTraitImports = entry => {
	traitImports.push(entry);
};

export const getTraitImports = () => traitImports;
