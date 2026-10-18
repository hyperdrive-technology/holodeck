# @holodeck/assets-aws

`holodeck.aws`: fifty-plus AWS services as data-only `holodeck.iso.part`s. Each part reuses a
`holodeck.cloud` archetype model, shows the **official AWS Architecture Icon** on the model's
`logo` slot, and takes its accent colour from the AWS service category. The package requires
`holodeck.cloud` (`^0.1`) for the shared Arcentry themes. ESM only, Node 26+, SDK as the only
runtime dependency.

Part ids are `aws:<slug>` (for example `aws:ec2`, `aws:elb`, `aws:s3`), matching `cloud:<name>`.
`@holodeck/provider-aws`' `DEFAULT_PART_HINTS` maps discovered resource kinds to these ids, and
`CLOUDWATCH_NAMESPACE_PARTS` maps a CloudWatch namespace (`AWS/EC2`) to a part id.

## Adding a service

1. Add a row to `src/services.json` (`slug`, `label`, `icon` = the `Arch_<icon>_64.svg` name,
   `category` from `src/categories.json`, `archetype`, `cloudwatchNamespace`, `hint`).
2. Download the AWS Architecture Icons package (URL and checksum in `src/icon-source.json`),
   extract it into a new empty directory, then `pnpm assets:sync <that directory>`.
   The script sanitises each SVG, checks the tile colour against the category and copies the
   archetype models from `../library-cloud`.
3. `pnpm test`: validates every part, icon and size budget.

## Archetype models are vendored

A package cannot reach another package's assets through `assetUrl`, so the GLBs used by the
catalogue are copied from `@holodeck/library-cloud` by `assets:sync`; a test fails if they drift.

## AWS icons, trademarks and licence

The SVGs in `assets/aws-icons/` are the official **AWS Architecture Icons** (release `07312026`,
<https://aws.amazon.com/architecture/icons/>), unmodified apart from stripping the XML prolog,
comments and whitespace. They are **not** covered by this package's MIT licence: they are
provided by AWS for building architecture diagrams, and the AWS service names and icons are
trademarks of Amazon.com, Inc. or its affiliates. Their use here does not imply sponsorship or
endorsement by AWS. See the AWS Architecture Icons terms and the
[AWS Trademark Guidelines](https://aws.amazon.com/trademark-guidelines/). The manifest's
`assetLicenses` entry carries this notice so hosts can show it in credits; it is also in
`assets/aws-icons/NOTICE.txt`. (Decision: holodeck#39, 2026-10-15. Publishing to npm remains a
separate, approval-gated step.)
