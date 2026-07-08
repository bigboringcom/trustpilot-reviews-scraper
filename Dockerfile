FROM apify/actor-node-playwright-chrome:20

USER root

COPY --chown=myuser:myuser . ./

USER myuser

RUN npm install --quiet --only=prod --no-optional && (npm list || true)

CMD npm start
