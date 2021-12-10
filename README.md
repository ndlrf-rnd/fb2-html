# FB2 -> HTML

## Insstallation

    $ git clone https://github.com/ndlrf-rnd/fb2-html.git
    $ cd ./fb2-html/
    $ npm install .

## Usage

    $ node ./src/index.js './input/*.fb2' ./output

Pay attention to __single__ quotes around input glob expression `'./input/*.fb2'`.

Without quotation or inside double quotes glob expression might be executed by shell and be expanded to huge args list of files as the param instead of single glob expression.

Also see [scripts/batch_run_example.sh](scripts/batch_run_example.sh) as more complex run scenario example.

