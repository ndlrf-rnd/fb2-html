#!/usr/bin/env bash

set -e

DIR="${1:-./data}"

if [[ -d "${DIR}" ]] ; then
    for f in `ls ${DIR}/*.zip` ; do
        echo "Processing ${f}..."
        unzip -o "${f}" -d "./input/" | pv -l > /dev/null
        node "./src/index.js" "./input/*.fb2" "./output"
        rm -rf "./input/*.fb2"
    done
else
    echo "Error: oath '${DIR}' does not exists! Please run script as following:"
    echo ""
    echo "$ ./batch_processing_example.sh ./folder/with/fb2/zip/archives/"
    exit -1
fi
