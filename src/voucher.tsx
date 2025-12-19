import sharp from 'sharp'
import ReactDomServer from 'react-dom/server'

export async function createBirthdayVoucher(
  templatePath: string,
  outputPath: string,
  name: string,
  expiration: string,
) {
  const { width, height } = await sharp(templatePath).metadata()
  const nameLayer = ReactDomServer.renderToStaticMarkup(
    <svg width={width} height={height}>
      <defs>
        <filter id="shadow">
          <feDropShadow dx="2" dy="2" stdDeviation="3" floodOpacity="0.5" />
        </filter>
      </defs>
      <text
        x="68"
        y="555"
        fontFamily="cursive"
        fontSize="48"
        fontWeight="700"
        fill="#FFD533"
        filter="url(#shadow)"
      >
        {name}
      </text>
    </svg>,
  )
  const expirationLayer = ReactDomServer.renderToStaticMarkup(
    <svg width={width} height={height}>
      <text
        x="185"
        y="1020"
        fontFamily="sans-serif"
        fontSize="27"
        fontWeight="600"
        fill="#FFFFFF"
      >
        {expiration}
      </text>
    </svg>,
  )

  await sharp(templatePath)
    .composite([
      { input: Buffer.from(nameLayer), top: 0, left: 0 },
      { input: Buffer.from(expirationLayer), top: 0, left: 0 },
    ])
    .png()
    .toFile(outputPath)
}
