# Receipts (part 2 §1 row 7), on the settled bid-revision auction dc7bd8ae…, winning leaf 2

- `inclusion-proof.json`: `benzo receipt prove`; `benzo receipt prove --check` prints OK inclusion proof.
- `settlement-statement.json`: `benzo receipt statement`, signed with the leaf's own bid owner key (kept by bid seal); `--check` prints OK settlement statement against result.json and the opened owner key.
- Neither file contains a destination.
