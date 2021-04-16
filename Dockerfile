FROM node:14

COPY ./entrypoint.sh /entrypoint.sh
RUN chmod u+x /entrypoint.sh

WORKDIR /code/fl-sync

CMD '/entrypoint.sh'
